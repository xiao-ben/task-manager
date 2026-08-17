import { NextRequest } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { PeriodTypeSchema, type Task } from "@task-manager/shared";
import { z } from "zod";
import { getDb } from "@/db";
import { tasks } from "@/db/schema";
import { generateAiSummary } from "@/lib/ai-summary";
import { corsPreflight, json, requireAuth } from "@/lib/http";
import { mapTask } from "@/lib/mappers";
import { memoryDb, useMemoryDb } from "@/lib/memory";

export async function OPTIONS() {
  return corsPreflight();
}

function daysInWeek(periodKey: string): { from: string; to: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(monday), to: fmt(sunday) };
}

function daysInMonth(periodKey: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const from = `${m[1]}-${m[2]}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

async function loadTasksForPeriod(
  periodType: string,
  periodKey: string,
): Promise<Task[]> {
  if (useMemoryDb()) {
    if (periodType === "day") {
      return memoryDb.listTasks({ day: periodKey });
    }
    const range =
      periodType === "week" ? daysInWeek(periodKey) : daysInMonth(periodKey);
    if (!range) return [];
    return memoryDb.listTasks({ from: range.from, to: range.to });
  }

  const db = getDb();
  if (periodType === "day") {
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.day, periodKey))
      .orderBy(asc(tasks.createdAt));
    return rows.map(mapTask);
  }
  const range =
    periodType === "week" ? daysInWeek(periodKey) : daysInMonth(periodKey);
  if (!range) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(and(gte(tasks.day, range.from), lte(tasks.day, range.to)))
    .orderBy(asc(tasks.day), asc(tasks.createdAt));
  return rows.map(mapTask);
}

const BodySchema = z.object({
  periodType: PeriodTypeSchema,
  periodKey: z.string().min(1).max(32),
});

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const { periodType, periodKey } = parsed.data;
  const periodTasks = await loadTasksForPeriod(periodType, periodKey);

  try {
    const draft = await generateAiSummary(periodType, periodKey, periodTasks);
    return json({ draft, tasks: periodTasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI 总结失败";
    const status = message.includes("未配置") ? 503 : 502;
    return json({ error: message }, status);
  }
}
