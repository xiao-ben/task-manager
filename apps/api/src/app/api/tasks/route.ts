import { NextRequest } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { CreateTaskSchema, todayKey } from "@task-manager/shared";
import { getDb } from "@/db";
import { tasks } from "@/db/schema";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { mapTask } from "@/lib/mappers";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sessionId = searchParams.get("cursorSessionId");

  if (useMemoryDb()) {
    return json({
      tasks: memoryDb.listTasks({
        day,
        from,
        to,
        cursorSessionId: sessionId,
      }),
    });
  }

  const db = getDb();
  const conditions = [];
  if (day) conditions.push(eq(tasks.day, day));
  if (from) conditions.push(gte(tasks.day, from));
  if (to) conditions.push(lte(tasks.day, to));
  if (sessionId) conditions.push(eq(tasks.cursorSessionId, sessionId));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(tasks)
          .where(and(...conditions))
          .orderBy(asc(tasks.createdAt))
      : await db.select().from(tasks).orderBy(asc(tasks.createdAt));

  return json({ tasks: rows.map(mapTask) });
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

  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const input = parsed.data;

  if (useMemoryDb()) {
    return json({ task: memoryDb.createTask(input) }, 201);
  }

  const db = getDb();
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      notes: input.notes ?? null,
      status: input.status,
      day: input.day ?? todayKey(),
      repoPath: input.repoPath ?? null,
      cursorAgentId: input.cursorAgentId ?? null,
      cursorSessionId: input.cursorSessionId ?? null,
      source: input.source,
    })
    .returning();

  return json({ task: mapTask(row) }, 201);
}
