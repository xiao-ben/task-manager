import { randomUUID } from "crypto";
import type {
  AgentRun,
  CreateAgentRunInput,
  CreateRepoInput,
  CreateTaskInput,
  PeriodType,
  Repo,
  Summary,
  Task,
  UpdateAgentRunInput,
  UpdateTaskInput,
} from "@task-manager/shared";
import { todayKey } from "@task-manager/shared";

const g = globalThis as unknown as {
  __tmStore?: {
    tasks: Task[];
    repos: Repo[];
    summaries: Summary[];
    agentRuns: AgentRun[];
  };
};

function store() {
  if (!g.__tmStore) {
    g.__tmStore = { tasks: [], repos: [], summaries: [], agentRuns: [] };
  }
  // 开发服务器热更新后旧 store 可能缺新 key
  g.__tmStore.agentRuns ??= [];
  return g.__tmStore;
}

function now() {
  return new Date().toISOString();
}

export const memoryDb = {
  listTasks(filter: {
    day?: string | null;
    from?: string | null;
    to?: string | null;
    cursorSessionId?: string | null;
  }): Task[] {
    return store()
      .tasks.filter((t) => {
        if (filter.day && t.day !== filter.day) return false;
        if (filter.from && t.day < filter.from) return false;
        if (filter.to && t.day > filter.to) return false;
        if (filter.cursorSessionId && t.cursorSessionId !== filter.cursorSessionId)
          return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  createTask(input: CreateTaskInput): Task {
    const ts = now();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      notes: input.notes ?? null,
      status: input.status ?? "todo",
      day: input.day ?? todayKey(),
      repoPath: input.repoPath ?? null,
      cursorAgentId: input.cursorAgentId ?? null,
      cursorSessionId: input.cursorSessionId ?? null,
      source: input.source ?? "manual",
      createdAt: ts,
      updatedAt: ts,
    };
    store().tasks.push(task);
    return task;
  },

  getTask(id: string): Task | undefined {
    return store().tasks.find((t) => t.id === id);
  },

  updateTask(id: string, input: UpdateTaskInput): { task?: Task; conflict?: Task } {
    const idx = store().tasks.findIndex((t) => t.id === id);
    if (idx < 0) return {};
    const current = store().tasks[idx];
    if (input.expectedUpdatedAt && current.updatedAt !== input.expectedUpdatedAt) {
      return { conflict: current };
    }
    const next: Task = {
      ...current,
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
      updatedAt: now(),
    };
    store().tasks[idx] = next;
    return { task: next };
  },

  deleteTask(id: string): boolean {
    const before = store().tasks.length;
    store().tasks = store().tasks.filter((t) => t.id !== id);
    return store().tasks.length < before;
  },

  listRepos(): Repo[] {
    return [...store().repos].sort((a, b) => a.name.localeCompare(b.name));
  },

  upsertRepo(input: CreateRepoInput): Repo {
    const existing = store().repos.find((r) => r.path === input.path);
    const ts = now();
    if (existing) {
      existing.name = input.name;
      existing.lastUsedAt = ts;
      existing.updatedAt = ts;
      return existing;
    }
    const repo: Repo = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      lastUsedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    store().repos.push(repo);
    return repo;
  },

  deleteRepo(id: string): boolean {
    const before = store().repos.length;
    store().repos = store().repos.filter((r) => r.id !== id);
    return store().repos.length < before;
  },

  touchRepo(id: string): boolean {
    const repo = store().repos.find((r) => r.id === id);
    if (!repo) return false;
    const ts = now();
    repo.lastUsedAt = ts;
    repo.updatedAt = ts;
    return true;
  },

  getSummary(periodType: PeriodType, periodKey: string): Summary | null {
    return (
      store().summaries.find(
        (s) => s.periodType === periodType && s.periodKey === periodKey,
      ) ?? null
    );
  },

  upsertSummary(
    periodType: PeriodType,
    periodKey: string,
    content: string,
  ): Summary {
    const existing = store().summaries.find(
      (s) => s.periodType === periodType && s.periodKey === periodKey,
    );
    const ts = now();
    if (existing) {
      existing.content = content;
      existing.updatedAt = ts;
      return existing;
    }
    const summary: Summary = {
      id: randomUUID(),
      periodType,
      periodKey,
      content,
      createdAt: ts,
      updatedAt: ts,
    };
    store().summaries.push(summary);
    return summary;
  },

  listAgentRuns(taskId: string): AgentRun[] {
    return store()
      .agentRuns.filter((r) => r.taskId === taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  createAgentRun(input: CreateAgentRunInput): AgentRun {
    const run: AgentRun = {
      id: randomUUID(),
      taskId: input.taskId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      status: "running",
      result: null,
      transcript: null,
      error: null,
      createdAt: now(),
      finishedAt: null,
    };
    store().agentRuns.push(run);
    return run;
  },

  updateAgentRun(id: string, input: UpdateAgentRunInput): AgentRun | undefined {
    const run = store().agentRuns.find((r) => r.id === id);
    if (!run) return undefined;
    if (input.status !== undefined) run.status = input.status;
    if (input.result !== undefined) run.result = input.result;
    if (input.transcript !== undefined) run.transcript = input.transcript;
    if (input.error !== undefined) run.error = input.error;
    if (input.status === "done" || input.status === "error") {
      run.finishedAt = now();
    }
    return run;
  },
};

export function useMemoryDb(): boolean {
  return process.env.USE_MEMORY_DB === "1" || !process.env.DATABASE_URL;
}
