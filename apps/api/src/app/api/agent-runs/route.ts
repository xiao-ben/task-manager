import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { CreateAgentRunSchema } from "@task-manager/shared";
import { getDb } from "@/db";
import { agentRuns } from "@/db/schema";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { mapAgentRun } from "@/lib/mappers";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  if (!taskId) {
    return json({ error: "taskId is required" }, 400);
  }

  if (useMemoryDb()) {
    return json({ runs: memoryDb.listAgentRuns(taskId) });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt));
  return json({ runs: rows.map(mapAgentRun) });
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = CreateAgentRunSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  if (useMemoryDb()) {
    return json({ run: memoryDb.createAgentRun(parsed.data) }, 201);
  }

  const db = getDb();
  const [row] = await db
    .insert(agentRuns)
    .values({
      taskId: parsed.data.taskId,
      agentId: parsed.data.agentId,
      runId: parsed.data.runId,
      status: "running",
    })
    .returning();
  return json({ run: mapAgentRun(row) }, 201);
}
