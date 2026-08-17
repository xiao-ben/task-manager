import type { Task, Repo, Summary, AgentRun } from "@task-manager/shared";
import type { tasks, repos, summaries, agentRuns } from "@/db/schema";
import { toIso } from "@/lib/http";

type TaskRow = typeof tasks.$inferSelect;
type RepoRow = typeof repos.$inferSelect;
type SummaryRow = typeof summaries.$inferSelect;
type AgentRunRow = typeof agentRuns.$inferSelect;

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status as Task["status"],
    day: row.day,
    repoPath: row.repoPath,
    cursorAgentId: row.cursorAgentId,
    cursorSessionId: row.cursorSessionId,
    source: row.source as Task["source"],
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export function mapRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    lastUsedAt: toIso(row.lastUsedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export function mapSummary(row: SummaryRow): Summary {
  return {
    id: row.id,
    periodType: row.periodType as Summary["periodType"],
    periodKey: row.periodKey,
    content: row.content,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export function mapAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    runId: row.runId,
    status: row.status as AgentRun["status"],
    result: row.result,
    transcript: row.transcript,
    error: row.error,
    createdAt: toIso(row.createdAt)!,
    finishedAt: toIso(row.finishedAt),
  };
}
