import { z } from "zod";

export const TaskStatusSchema = z.enum(["todo", "doing", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSourceSchema = z.enum(["manual", "cursor", "agent"]);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const PeriodTypeSchema = z.enum(["day", "week", "month"]);
export type PeriodType = z.infer<typeof PeriodTypeSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  notes: z.string().nullable().default(null),
  status: TaskStatusSchema,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repoPath: z.string().nullable().default(null),
  cursorAgentId: z.string().nullable().default(null),
  cursorSessionId: z.string().nullable().default(null),
  source: TaskSourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().optional().nullable(),
  status: TaskStatusSchema.optional().default("todo"),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  repoPath: z.string().optional().nullable(),
  cursorAgentId: z.string().optional().nullable(),
  cursorSessionId: z.string().optional().nullable(),
  source: TaskSourceSchema.optional().default("manual"),
});
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  repoPath: z.string().nullable().optional(),
  cursorAgentId: z.string().nullable().optional(),
  cursorSessionId: z.string().nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const AgentRunStatusSchema = z.enum(["running", "done", "error"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string(),
  agentId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  status: AgentRunStatusSchema,
  result: z.string().nullable().default(null),
  transcript: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const CreateAgentRunSchema = z.object({
  taskId: z.string().min(1),
  agentId: z.string().optional().nullable().default(null),
  runId: z.string().optional().nullable().default(null),
});
export type CreateAgentRunInput = z.input<typeof CreateAgentRunSchema>;

export const UpdateAgentRunSchema = z.object({
  status: AgentRunStatusSchema.optional(),
  result: z.string().nullable().optional(),
  transcript: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type UpdateAgentRunInput = z.infer<typeof UpdateAgentRunSchema>;

export const RepoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const CreateRepoSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1),
});
export type CreateRepoInput = z.infer<typeof CreateRepoSchema>;

export const SummarySchema = z.object({
  id: z.string().uuid(),
  periodType: PeriodTypeSchema,
  periodKey: z.string().min(1).max(32),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Summary = z.infer<typeof SummarySchema>;

export const UpsertSummarySchema = z.object({
  periodType: PeriodTypeSchema,
  periodKey: z.string().min(1).max(32),
  content: z.string(),
});
export type UpsertSummaryInput = z.infer<typeof UpsertSummarySchema>;

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, delta: number): string {
  const d = parseLocalDay(day);
  d.setDate(d.getDate() + delta);
  return todayKey(d);
}

/** ISO week key like 2026-W32 */
export function weekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function monthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function periodRange(
  periodType: PeriodType,
  periodKey: string,
): { from: string; to: string } {
  if (periodType === "day") return { from: periodKey, to: periodKey };
  if (periodType === "week") {
    const m = /^(\d{4})-W(\d{2})$/.exec(periodKey);
    if (!m) return { from: periodKey, to: periodKey };
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
  const [y, mo] = periodKey.split("-").map(Number);
  const from = `${periodKey}-01`;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from, to: `${periodKey}-${String(last).padStart(2, "0")}` };
}

/** Shift day/week/month key by ±1 period */
export function shiftPeriodKey(
  periodType: PeriodType,
  periodKey: string,
  delta: number,
): string {
  if (periodType === "day") return addDays(periodKey, delta);
  if (periodType === "week") {
    const { from } = periodRange("week", periodKey);
    return weekKey(parseLocalDay(addDays(from, delta * 7)));
  }
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function periodKeyFromDay(periodType: PeriodType, day: string): string {
  const d = parseLocalDay(day);
  if (periodType === "day") return todayKey(d);
  if (periodType === "week") return weekKey(d);
  return monthKey(d);
}

export function generateSummaryDraft(
  periodType: PeriodType,
  periodKey: string,
  tasks: Task[],
): string {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const todo = tasks.filter((t) => t.status === "todo").length;
  const cancelled = tasks.filter((t) => t.status === "cancelled").length;

  const lines = [
    `# ${periodType === "day" ? "日" : periodType === "week" ? "周" : "月"}总结 · ${periodKey}`,
    "",
    `完成 ${done}/${total} · 进行中 ${doing} · 待办 ${todo} · 取消 ${cancelled}`,
    "",
    "## 任务明细",
    "",
  ];

  if (tasks.length === 0) {
    lines.push("- （本周期暂无任务）");
  } else {
    for (const t of tasks) {
      const mark =
        t.status === "done" ? "[x]" : t.status === "cancelled" ? "[-]" : "[ ]";
      const extra = t.repoPath ? ` \`${t.repoPath}\`` : "";
      lines.push(`- ${mark} ${t.title}${extra}`);
      if (t.notes?.trim()) {
        lines.push(`  - ${t.notes.trim().replace(/\n/g, " ")}`);
      }
    }
  }

  lines.push("", "## 备注", "", "");
  return lines.join("\n");
}

/** Inbox / 库 / 原则 / 对话 — local-first, not synced to the cloud API yet. */

export const InboxSourceSchema = z.enum([
  "manual",
  "widget",
  "conversation",
  "agent",
  "other",
]);
export type InboxSource = z.infer<typeof InboxSourceSchema>;

export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  body: z.string().min(1).max(4000),
  source: InboxSourceSchema,
  conversationId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const LibraryKindSchema = z.enum([
  "note",
  "judgment",
  "excerpt",
]);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LibraryEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(20000).default(""),
  kind: LibraryKindSchema,
  lensIds: z.array(z.string()).default([]),
  taskIds: z.array(z.string()).default([]),
  conversationIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

export const LensSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  domain: z.string().max(80).default(""),
  what: z.string().max(2000).default(""),
  when: z.string().max(2000).default(""),
  whenNot: z.string().max(2000).default(""),
  questions: z.array(z.string().max(300)).max(8).default([]),
  draft: z.boolean().default(false),
  usedCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lens = z.infer<typeof LensSchema>;

export const ConversationSourceSchema = z.enum([
  "cursor",
  "claude",
  "chatgpt",
  "other",
]);
export type ConversationSource = z.infer<typeof ConversationSourceSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  source: ConversationSourceSchema,
  body: z.string().max(100000).default(""),
  taskId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const TaskLensLinkSchema = z.object({
  taskId: z.string(),
  lensId: z.string(),
});
export type TaskLensLink = z.infer<typeof TaskLensLinkSchema>;

export {
  IngestDepositSchema,
  IngestPrincipleSchema,
  applyIngestToDb,
  ensureIngestCollections,
} from "./ingest.js";
export type {
  IngestDeposit,
  IngestDepositInput,
  IngestResult,
  IngestableDb,
} from "./ingest.js";
