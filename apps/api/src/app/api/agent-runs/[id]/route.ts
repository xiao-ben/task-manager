import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { UpdateAgentRunSchema } from "@task-manager/shared";
import { getDb } from "@/db";
import { agentRuns } from "@/db/schema";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { mapAgentRun } from "@/lib/mappers";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = UpdateAgentRunSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const finished =
    parsed.data.status === "done" || parsed.data.status === "error";

  if (useMemoryDb()) {
    const run = memoryDb.updateAgentRun(id, parsed.data);
    if (!run) return json({ error: "Not found" }, 404);
    return json({ run });
  }

  const db = getDb();
  const [row] = await db
    .update(agentRuns)
    .set({
      ...(parsed.data.status !== undefined
        ? { status: parsed.data.status }
        : {}),
      ...(parsed.data.result !== undefined ? { result: parsed.data.result } : {}),
      ...(parsed.data.transcript !== undefined
        ? { transcript: parsed.data.transcript }
        : {}),
      ...(parsed.data.error !== undefined ? { error: parsed.data.error } : {}),
      ...(finished ? { finishedAt: new Date() } : {}),
    })
    .where(eq(agentRuns.id, id))
    .returning();
  if (!row) return json({ error: "Not found" }, 404);
  return json({ run: mapAgentRun(row) });
}
