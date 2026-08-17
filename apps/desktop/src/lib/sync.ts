import type {
  AgentRun,
  CreateRepoInput,
  CreateTaskInput,
  PeriodType,
  Repo,
  Summary,
  Task,
  UpdateTaskInput,
  UpsertSummaryInput,
} from "@task-manager/shared";
import { api } from "./api";
import { bumpLocalDbWatchBaseline } from "./dbWatch";
import { readLocalDb, writeLocalDb, type LocalDb } from "./localDb";
import { loadSettings } from "./settings";

type QueueItem = {
  id: string;
  method: "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  body?: unknown;
  createdAt: string;
};

const QUEUE_KEY = "task-manager.sync_queue";

let memory: LocalDb | null = null;
let lastError: string | null = null;
let lastSyncedAt: string | null = null;
let remoteOffline = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function readQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueueItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function enqueue(item: Omit<QueueItem, "id" | "createdAt">) {
  const queue = readQueue();
  queue.push({
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  writeQueue(queue);
}

function syncEnabled(): boolean {
  const s = loadSettings();
  return Boolean(s.syncEnabled && s.apiBaseUrl?.trim());
}

async function ensureMemory(): Promise<LocalDb> {
  if (!memory) {
    memory = await readLocalDb();
  }
  return memory;
}

/** Re-read from disk (hooks / other windows may have written). */
async function reloadFromDisk(): Promise<LocalDb> {
  memory = await readLocalDb();
  return memory;
}

async function persist(db: LocalDb): Promise<LocalDb> {
  // writeLocalDb returns the revision-bumped snapshot — avoid a second disk read
  memory = await writeLocalDb(db);
  void bumpLocalDbWatchBaseline();
  emit();
  return memory;
}

function filterTasks(
  tasks: Task[],
  params: { day?: string; from?: string; to?: string } = {},
): Task[] {
  if (params.day) return tasks.filter((t) => t.day === params.day);
  if (params.from && params.to) {
    return tasks.filter((t) => t.day >= params.from! && t.day <= params.to!);
  }
  return tasks;
}

function newer(a: string, b: string): boolean {
  return a > b;
}

export type SyncStatus = {
  syncEnabled: boolean;
  online: boolean;
  pending: number;
  remoteOffline: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** Sidebar badge text */
  label: string;
};

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatus(): SyncStatus {
  const enabled = syncEnabled();
  const pending = readQueue().length;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  let label = "仅本地";
  if (enabled) {
    if (!online || remoteOffline) label = "远端离线";
    else if (pending > 0) label = `待同步 ${pending}`;
    else if (lastSyncedAt) label = "已同步";
    else label = "待同步";
  }
  return {
    syncEnabled: enabled,
    online,
    pending,
    remoteOffline,
    lastError: enabled ? lastError : null,
    lastSyncedAt,
    label,
  };
}

export function getCachedTasks(day?: string): Task[] {
  const tasks = memory?.tasks ?? [];
  return day ? tasks.filter((t) => t.day === day) : tasks;
}

export function upsertCachedTask(task: Task) {
  if (!memory) {
    memory = {
      tasks: [task],
      repos: [],
      summaries: [],
      agentRuns: [],
      deletedTaskIds: [],
      revision: 1,
    };
  } else {
    memory = {
      ...memory,
      tasks: [...memory.tasks.filter((t) => t.id !== task.id), task],
    };
  }
  emit();
}

export function removeCachedTask(id: string) {
  if (!memory) return;
  memory = {
    ...memory,
    tasks: memory.tasks.filter((t) => t.id !== id),
  };
  emit();
}

/** Load local tasks (optionally merge from remote when sync is on). */
export async function pullTasks(
  params: { day?: string; from?: string; to?: string } = {},
): Promise<Task[]> {
  const prevRev = memory?.revision;
  await reloadFromDisk();
  let merged = false;
  if (syncEnabled()) {
    try {
      await pullMergeTasks(params);
      merged = true;
      remoteOffline = false;
      lastError = null;
      lastSyncedAt = new Date().toISOString();
    } catch (err) {
      remoteOffline = true;
      lastError = err instanceof Error ? err.message : "远端不可用";
      emit();
    }
  }
  const latest = memory ?? (await ensureMemory());
  // Only notify UI when data actually changed — avoids refresh storms
  if (merged || latest.revision !== prevRev) {
    emit();
  }
  return filterTasks(latest.tasks, params);
}

async function pullMergeTasks(
  params: { day?: string; from?: string; to?: string } = {},
): Promise<void> {
  const { tasks: remote } = await api.listTasks(
    params.day || params.from
      ? params
      : {},
  );
  const db = await ensureMemory();
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const deleted = new Set(db.deletedTaskIds);
  let changed = false;

  for (const rt of remote) {
    if (deleted.has(rt.id)) continue;
    const local = byId.get(rt.id);
    if (!local) {
      byId.set(rt.id, rt);
      changed = true;
    } else if (newer(rt.updatedAt, local.updatedAt)) {
      byId.set(rt.id, rt);
      changed = true;
    } else if (newer(local.updatedAt, rt.updatedAt)) {
      enqueue({
        method: "PATCH",
        path: `/api/tasks/${local.id}`,
        body: {
          title: local.title,
          notes: local.notes,
          status: local.status,
          day: local.day,
          repoPath: local.repoPath,
          cursorAgentId: local.cursorAgentId,
          cursorSessionId: local.cursorSessionId,
          expectedUpdatedAt: rt.updatedAt,
        },
      });
    }
  }

  // Local-only tasks → push create
  const remoteIds = new Set(remote.map((t) => t.id));
  for (const local of db.tasks) {
    if (!remoteIds.has(local.id) && !deleted.has(local.id)) {
      const inWindow = filterTasks([local], params).length > 0 || (!params.day && !params.from);
      if (inWindow || !params.day) {
        // Avoid duplicate queue entries: check rough
        const q = readQueue();
        const already = q.some(
          (i) =>
            i.method === "POST" &&
            i.path === "/api/tasks" &&
            (i.body as { clientId?: string })?.clientId === local.id,
        );
        if (!already) {
          enqueue({
            method: "POST",
            path: "/api/tasks",
            body: {
              clientId: local.id,
              title: local.title,
              notes: local.notes,
              status: local.status,
              day: local.day,
              repoPath: local.repoPath,
              cursorAgentId: local.cursorAgentId,
              cursorSessionId: local.cursorSessionId,
              source: local.source,
            },
          });
        }
      }
    }
  }

  if (changed) {
    // persist already emits
    await persist({
      ...db,
      tasks: [...byId.values()],
    });
  }
}

export async function createTaskOptimistic(
  input: CreateTaskInput,
): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    title: input.title,
    notes: input.notes ?? null,
    status: input.status ?? "todo",
    day: input.day ?? new Date().toISOString().slice(0, 10),
    repoPath: input.repoPath ?? null,
    cursorAgentId: input.cursorAgentId ?? null,
    cursorSessionId: input.cursorSessionId ?? null,
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now,
  };
  const db = await ensureMemory();
  await persist({ ...db, tasks: [...db.tasks, task] });

  if (syncEnabled()) {
    enqueue({
      method: "POST",
      path: "/api/tasks",
      body: {
        clientId: task.id,
        title: task.title,
        notes: task.notes,
        status: task.status,
        day: task.day,
        repoPath: task.repoPath,
        cursorAgentId: task.cursorAgentId,
        cursorSessionId: task.cursorSessionId,
        source: task.source,
      },
    });
    void flushSyncQueue();
  }
  return task;
}

export async function updateTaskOptimistic(
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const db = await ensureMemory();
  const current = db.tasks.find((t) => t.id === id);
  if (!current) throw new Error("Task not found");

  const { expectedUpdatedAt: _ignored, ...patch } = input;
  void _ignored;
  const optimistic: Task = {
    ...current,
    ...patch,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    id: current.id,
    createdAt: current.createdAt,
    source: current.source,
    updatedAt: new Date().toISOString(),
  };

  await persist({
    ...db,
    tasks: db.tasks.map((t) => (t.id === id ? optimistic : t)),
  });

  if (syncEnabled()) {
    enqueue({
      method: "PATCH",
      path: `/api/tasks/${id}`,
      body: { ...patch, expectedUpdatedAt: current.updatedAt },
    });
    void flushSyncQueue();
  }
  return optimistic;
}

export async function deleteTaskOptimistic(id: string): Promise<void> {
  const db = await ensureMemory();
  await persist({
    ...db,
    tasks: db.tasks.filter((t) => t.id !== id),
    deletedTaskIds: [...new Set([...db.deletedTaskIds, id])].slice(-2000),
  });

  if (syncEnabled()) {
    enqueue({ method: "DELETE", path: `/api/tasks/${id}` });
    void flushSyncQueue();
  }
}

/** Restore a previously deleted task (Undo). */
export async function restoreTaskOptimistic(task: Task): Promise<Task> {
  const db = await ensureMemory();
  const now = new Date().toISOString();
  const restored: Task = { ...task, updatedAt: now };
  await persist({
    ...db,
    tasks: [...db.tasks.filter((t) => t.id !== task.id), restored],
    deletedTaskIds: db.deletedTaskIds.filter((x) => x !== task.id),
  });
  if (syncEnabled()) {
    enqueue({
      method: "POST",
      path: "/api/tasks",
      body: {
        id: restored.id,
        title: restored.title,
        notes: restored.notes,
        status: restored.status,
        day: restored.day,
        repoPath: restored.repoPath,
        source: restored.source,
      },
    });
    void flushSyncQueue();
  }
  return restored;
}

export async function listAgentRunsLocal(taskId: string): Promise<AgentRun[]> {
  const db = await ensureMemory();
  const local = db.agentRuns
    .filter((r) => r.taskId === taskId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (syncEnabled()) {
    try {
      const { runs } = await api.listAgentRuns(taskId);
      const byId = new Map(local.map((r) => [r.id, r]));
      for (const r of runs) {
        const prev = byId.get(r.id);
        if (!prev || newer(r.finishedAt ?? r.createdAt, prev.finishedAt ?? prev.createdAt)) {
          byId.set(r.id, r);
        }
      }
      const merged = [...byId.values()].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );
      const others = db.agentRuns.filter((r) => r.taskId !== taskId);
      await persist({
        ...db,
        agentRuns: [...others, ...merged].slice(-500),
      });
      remoteOffline = false;
      return merged;
    } catch {
      remoteOffline = true;
    }
  }
  return local;
}

export async function upsertAgentRunLocal(
  run: AgentRun,
): Promise<AgentRun> {
  const db = await ensureMemory();
  const exists = db.agentRuns.some((r) => r.id === run.id);
  const agentRuns = exists
    ? db.agentRuns.map((r) => (r.id === run.id ? run : r))
    : [...db.agentRuns, run];
  await persist({ ...db, agentRuns: agentRuns.slice(-500) });
  return run;
}

export async function createLocalAgentRun(input: {
  taskId: string;
  agentId?: string | null;
  runId?: string | null;
}): Promise<AgentRun> {
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: crypto.randomUUID(),
    taskId: input.taskId,
    agentId: input.agentId ?? null,
    runId: input.runId ?? null,
    status: "running",
    result: null,
    transcript: null,
    error: null,
    createdAt: now,
    finishedAt: null,
  };
  return upsertAgentRunLocal(run);
}

export async function listReposLocal(): Promise<Repo[]> {
  const db = await ensureMemory();
  if (syncEnabled()) {
    try {
      const { repos } = await api.listRepos();
      const byPath = new Map(db.repos.map((r) => [r.path, r]));
      for (const rr of repos) {
        const local = byPath.get(rr.path);
        if (!local || newer(rr.updatedAt, local.updatedAt)) {
          byPath.set(rr.path, rr);
        }
      }
      const merged = [...byPath.values()];
      if (JSON.stringify(merged) !== JSON.stringify(db.repos)) {
        await persist({ ...db, repos: merged });
      }
      remoteOffline = false;
    } catch {
      remoteOffline = true;
    }
  }
  return (await ensureMemory()).repos;
}

export async function upsertRepoLocal(input: CreateRepoInput): Promise<Repo> {
  const db = await ensureMemory();
  const now = new Date().toISOString();
  const existing = db.repos.find((r) => r.path === input.path);
  const repo: Repo = existing
    ? {
        ...existing,
        name: input.name,
        updatedAt: now,
        lastUsedAt: now,
      }
    : {
        id: crypto.randomUUID(),
        name: input.name,
        path: input.path,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      };
  const repos = existing
    ? db.repos.map((r) => (r.path === input.path ? repo : r))
    : [...db.repos, repo];
  await persist({ ...db, repos });

  if (syncEnabled()) {
    try {
      const { repo: remote } = await api.upsertRepo(input);
      const latest = await ensureMemory();
      await persist({
        ...latest,
        repos: latest.repos.map((r) =>
          r.path === remote.path ? remote : r,
        ),
      });
    } catch {
      enqueue({ method: "POST", path: "/api/repos", body: input });
      remoteOffline = true;
    }
  }
  return repo;
}

export async function deleteRepoLocal(id: string): Promise<void> {
  const db = await ensureMemory();
  await persist({ ...db, repos: db.repos.filter((r) => r.id !== id) });
  if (syncEnabled()) {
    try {
      await api.deleteRepo(id);
    } catch {
      enqueue({ method: "DELETE", path: `/api/repos/${id}` });
    }
  }
}

function buildDraft(tasks: Task[], periodType: PeriodType, periodKey: string): string {
  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status === "todo" || t.status === "doing");
  const lines = [
    `# ${periodType === "day" ? "日" : periodType === "week" ? "周" : "月"}总结 · ${periodKey}`,
    "",
    `完成 ${done.length} · 未完成 ${open.length} · 共 ${tasks.length}`,
    "",
    "## 已完成",
    ...(done.length ? done.map((t) => `- ${t.title}`) : ["- （无）"]),
    "",
    "## 进行中 / 待办",
    ...(open.length ? open.map((t) => `- [${t.status}] ${t.title}`) : ["- （无）"]),
  ];
  return lines.join("\n");
}

export async function getSummaryLocal(
  type: PeriodType,
  key: string,
  draft = false,
): Promise<{ summary: Summary | null; draft?: string; tasks?: Task[] }> {
  const db = await ensureMemory();
  let summary =
    db.summaries.find((s) => s.periodType === type && s.periodKey === key) ??
    null;

  if (syncEnabled()) {
    try {
      const res = await api.getSummary(type, key, draft);
      if (
        res.summary &&
        (!summary || newer(res.summary.updatedAt, summary.updatedAt))
      ) {
        summary = res.summary;
        const others = db.summaries.filter(
          (s) => !(s.periodType === type && s.periodKey === key),
        );
        await persist({ ...db, summaries: [...others, res.summary] });
      }
      if (draft) {
        return {
          summary,
          draft: res.draft ?? summary?.content ?? "",
          tasks: res.tasks,
        };
      }
      remoteOffline = false;
    } catch {
      remoteOffline = true;
    }
  }

  if (draft) {
    const tasks = db.tasks; // caller may filter; keep simple draft from all / day
    const scoped =
      type === "day"
        ? tasks.filter((t) => t.day === key)
        : tasks;
    return {
      summary,
      draft: summary?.content || buildDraft(scoped, type, key),
      tasks: scoped,
    };
  }
  return { summary };
}

export async function upsertSummaryLocal(
  input: UpsertSummaryInput,
): Promise<Summary> {
  const db = await ensureMemory();
  const now = new Date().toISOString();
  const existing = db.summaries.find(
    (s) => s.periodType === input.periodType && s.periodKey === input.periodKey,
  );
  const summary: Summary = existing
    ? { ...existing, content: input.content, updatedAt: now }
    : {
        id: crypto.randomUUID(),
        periodType: input.periodType,
        periodKey: input.periodKey,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      };
  const summaries = existing
    ? db.summaries.map((s) =>
        s.periodType === input.periodType && s.periodKey === input.periodKey
          ? summary
          : s,
      )
    : [...db.summaries, summary];
  await persist({ ...db, summaries });

  if (syncEnabled()) {
    try {
      const res = await api.upsertSummary(input);
      const latest = await ensureMemory();
      await persist({
        ...latest,
        summaries: latest.summaries.map((s) =>
          s.periodType === res.summary.periodType &&
          s.periodKey === res.summary.periodKey
            ? res.summary
            : s,
        ),
      });
      return res.summary;
    } catch {
      enqueue({ method: "PUT", path: "/api/summaries", body: input });
      remoteOffline = true;
    }
  }
  return summary;
}

export async function flushSyncQueue(): Promise<void> {
  if (!syncEnabled()) return;
  const queue = readQueue();
  if (queue.length === 0) {
    return;
  }

  const { apiBaseUrl, apiToken } = loadSettings();
  const remaining: QueueItem[] = [];

  for (const item of queue) {
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${item.path}`, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (res.status === 409) {
        const task = (body as { task?: Task } | null)?.task;
        if (task) {
          const db = await ensureMemory();
          await persist({
            ...db,
            tasks: [...db.tasks.filter((t) => t.id !== task.id), task],
          });
        }
        continue;
      }
      if (
        res.ok &&
        item.method === "POST" &&
        item.path === "/api/tasks"
      ) {
        const task = (body as { task?: Task } | null)?.task;
        const clientId = (item.body as { clientId?: string } | undefined)
          ?.clientId;
        if (task && clientId && clientId !== task.id) {
          const db = await ensureMemory();
          await persist({
            ...db,
            tasks: [
              ...db.tasks.filter((t) => t.id !== clientId && t.id !== task.id),
              task,
            ],
          });
        } else if (task) {
          const db = await ensureMemory();
          await persist({
            ...db,
            tasks: [...db.tasks.filter((t) => t.id !== task.id), task],
          });
        }
        continue;
      }
      if (!res.ok && res.status !== 404) {
        remaining.push(item);
        if (res.status >= 500 || res.status === 402) {
          remoteOffline = true;
        }
      }
    } catch {
      remaining.push(item);
      remoteOffline = true;
    }
  }

  writeQueue(remaining);
  lastSyncedAt = new Date().toISOString();
  lastError = remaining.length
    ? remoteOffline
      ? "远端离线"
      : "部分变更待同步"
    : null;
  if (remaining.length === 0) remoteOffline = false;
  emit();
}

/** Full bidirectional sync: flush queue + pull tasks/repos/summaries. */
export async function syncNow(): Promise<void> {
  if (!syncEnabled()) {
    lastError = null;
    remoteOffline = false;
    emit();
    return;
  }
  try {
    await flushSyncQueue();
    await pullMergeTasks({});
    await listReposLocal();
    remoteOffline = false;
    lastError = null;
    lastSyncedAt = new Date().toISOString();
  } catch (err) {
    remoteOffline = true;
    lastError = err instanceof Error ? err.message : "同步失败";
  }
  emit();
}

/** Warm local memory on app start. */
export async function initLocalStore(): Promise<void> {
  await ensureMemory();
  emit();
}

/** Re-read local DB after external import/restore. */
export async function reloadLocalStore(): Promise<LocalDb> {
  const db = await reloadFromDisk();
  emit();
  return db;
}
