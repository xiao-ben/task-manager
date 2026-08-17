import type { AgentRun, Repo, Summary, Task } from "@task-manager/shared";

export type LocalDb = {
  tasks: Task[];
  repos: Repo[];
  summaries: Summary[];
  agentRuns: AgentRun[];
  deletedTaskIds: string[];
  revision: number;
};

const BROWSER_KEY = "task-manager.local.db";
const LEGACY_CACHE_KEY = "task-manager.cache.tasks";

const EMPTY_DB: LocalDb = {
  tasks: [],
  repos: [],
  summaries: [],
  agentRuns: [],
  deletedTaskIds: [],
  revision: 1,
};

type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
let invokeFn: InvokeFn | null = null;
let migratedOnce = false;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getInvoke(): Promise<InvokeFn> {
  if (invokeFn) return invokeFn;
  const mod = await import("@tauri-apps/api/core");
  invokeFn = ((cmd, args) => mod.invoke(cmd, args)) as InvokeFn;
  return invokeFn;
}

function normalize(raw: unknown): LocalDb {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<LocalDb>;
  return {
    tasks: Array.isArray(o.tasks) ? (o.tasks as Task[]) : [],
    repos: Array.isArray(o.repos) ? (o.repos as Repo[]) : [],
    summaries: Array.isArray(o.summaries) ? (o.summaries as Summary[]) : [],
    agentRuns: Array.isArray(o.agentRuns) ? (o.agentRuns as AgentRun[]) : [],
    deletedTaskIds: Array.isArray(o.deletedTaskIds)
      ? (o.deletedTaskIds as string[])
      : [],
    revision: typeof o.revision === "number" ? o.revision : 1,
  };
}

function migrateLegacyCache(db: LocalDb): LocalDb {
  if (db.tasks.length > 0 || migratedOnce) return db;
  migratedOnce = true;
  try {
    const raw = localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return db;
    const tasks = JSON.parse(raw) as Task[];
    if (!Array.isArray(tasks) || tasks.length === 0) return db;
    return { ...db, tasks, revision: db.revision + 1 };
  } catch {
    return db;
  }
}

export async function readLocalDb(): Promise<LocalDb> {
  if (isTauri()) {
    try {
      const invoke = await getInvoke();
      const text = (await invoke("read_local_db")) as string;
      let db = normalize(JSON.parse(text || "{}"));
      const migrated = migrateLegacyCache(db);
      if (migrated.tasks.length > db.tasks.length) {
        return writeLocalDb(migrated);
      }
      return db;
    } catch {
      // fall through to browser key
    }
  }
  try {
    const raw = localStorage.getItem(BROWSER_KEY);
    let db = normalize(raw ? JSON.parse(raw) : {});
    const migrated = migrateLegacyCache(db);
    if (migrated.tasks.length > db.tasks.length) {
      localStorage.setItem(BROWSER_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return db;
  } catch {
    return { ...EMPTY_DB };
  }
}

/** Persist and return the written DB (with bumped revision). */
export async function writeLocalDb(db: LocalDb): Promise<LocalDb> {
  const next: LocalDb = { ...db, revision: (db.revision || 0) + 1 };
  const text = JSON.stringify(next);
  if (isTauri()) {
    try {
      const invoke = await getInvoke();
      await invoke("write_local_db", { json: text });
      try {
        localStorage.setItem(BROWSER_KEY, text);
      } catch {
        /* ignore */
      }
      return next;
    } catch {
      /* fall through */
    }
  }
  localStorage.setItem(BROWSER_KEY, text);
  return next;
}

export async function updateLocalDb(
  mutator: (db: LocalDb) => LocalDb | void,
): Promise<LocalDb> {
  const db = await readLocalDb();
  const result = mutator(db);
  const next = result ?? db;
  return writeLocalDb(next);
}
