import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { UpdateTaskSchema } from "@task-manager/shared";
import { getDb } from "@/db";
import { tasks } from "@/db/schema";
import { corsPreflight, json, requireAuth, toIso } from "@/lib/http";
import { mapTask } from "@/lib/mappers";
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

  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const input = parsed.data;

  if (useMemoryDb()) {
    const result = memoryDb.updateTask(id, input);
    if (result.conflict) {
      return json({ error: "Conflict", task: result.conflict }, 409);
    }
    if (!result.task) {
      return json({ error: "Not found" }, 404);
    }
    return json({ task: result.task });
  }

  const db = getDb();
  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (existing.length === 0) {
    return json({ error: "Not found" }, 404);
  }

  const current = existing[0];

  if (input.expectedUpdatedAt) {
    const currentIso = toIso(current.updatedAt);
    if (currentIso !== input.expectedUpdatedAt) {
      return json({ error: "Conflict", task: mapTask(current) }, 409);
    }
  }

  const [row] = await db
    .update(tasks)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.day !== undefined ? { day: input.day } : {}),
      ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
      ...(input.cursorAgentId !== undefined
        ? { cursorAgentId: input.cursorAgentId }
        : {}),
      ...(input.cursorSessionId !== undefined
        ? { cursorSessionId: input.cursorSessionId }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
    .returning();

  return json({ task: mapTask(row) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  if (useMemoryDb()) {
    if (!memoryDb.deleteTask(id)) {
      return json({ error: "Not found" }, 404);
    }
    return json({ ok: true });
  }

  const db = getDb();
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (deleted.length === 0) {
    return json({ error: "Not found" }, 404);
  }
  return json({ ok: true });
}
