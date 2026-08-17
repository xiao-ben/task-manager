import { readLocalDb, writeLocalDb, type LocalDb } from "./localDb";

export const BACKUP_FORMAT = "task-manager-backup" as const;
export const BACKUP_VERSION = 1 as const;

export type HistoryBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: LocalDb;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeDb(raw: unknown): LocalDb {
  const o = isRecord(raw) ? raw : {};
  return {
    tasks: Array.isArray(o.tasks) ? (o.tasks as LocalDb["tasks"]) : [],
    repos: Array.isArray(o.repos) ? (o.repos as LocalDb["repos"]) : [],
    summaries: Array.isArray(o.summaries)
      ? (o.summaries as LocalDb["summaries"])
      : [],
    agentRuns: Array.isArray(o.agentRuns)
      ? (o.agentRuns as LocalDb["agentRuns"])
      : [],
    deletedTaskIds: Array.isArray(o.deletedTaskIds)
      ? (o.deletedTaskIds as string[])
      : [],
    revision: typeof o.revision === "number" ? o.revision : 1,
  };
}

/** Accept wrapped backup or raw LocalDb JSON. */
export function parseHistoryBackup(raw: string): LocalDb {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  if (!isRecord(parsed)) {
    throw new Error("备份文件格式无效");
  }
  if (parsed.format === BACKUP_FORMAT) {
    return normalizeDb(parsed.data);
  }
  // raw data.json
  if (
    Array.isArray(parsed.tasks) ||
    Array.isArray(parsed.repos) ||
    Array.isArray(parsed.summaries)
  ) {
    return normalizeDb(parsed);
  }
  throw new Error("无法识别的备份格式");
}

export async function buildHistoryBackup(): Promise<HistoryBackup> {
  const data = await readLocalDb();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

function newerIso(a?: string | null, b?: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b;
}

/** Merge by id; keep the side with newer updatedAt (or incoming if missing). */
export function mergeLocalDb(current: LocalDb, incoming: LocalDb): LocalDb {
  const mergeById = <T extends { id: string; updatedAt?: string }>(
    a: T[],
    b: T[],
  ): T[] => {
    const map = new Map<string, T>();
    for (const item of a) map.set(item.id, item);
    for (const item of b) {
      const prev = map.get(item.id);
      if (!prev || newerIso(item.updatedAt, prev.updatedAt)) {
        map.set(item.id, item);
      }
    }
    return [...map.values()];
  };

  const deleted = new Set([
    ...current.deletedTaskIds,
    ...incoming.deletedTaskIds,
  ]);
  const tasks = mergeById(current.tasks, incoming.tasks).filter(
    (t) => !deleted.has(t.id),
  );

  return {
    tasks,
    repos: mergeById(current.repos, incoming.repos),
    summaries: mergeById(current.summaries, incoming.summaries),
    agentRuns: mergeById(
      current.agentRuns ?? [],
      incoming.agentRuns ?? [],
    ),
    deletedTaskIds: [...deleted],
    revision: Math.max(current.revision || 1, incoming.revision || 1),
  };
}

export async function importHistoryDb(
  incoming: LocalDb,
  mode: "replace" | "merge",
): Promise<LocalDb> {
  if (mode === "replace") {
    return writeLocalDb({ ...incoming, revision: incoming.revision || 1 });
  }
  const current = await readLocalDb();
  return writeLocalDb(mergeLocalDb(current, incoming));
}

function defaultExportName(): string {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
  return `task-manager-backup-${stamp}.json`;
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function exportHistoryToFile(): Promise<string> {
  const backup = await buildHistoryBackup();
  const text = JSON.stringify(backup, null, 2);
  const filename = defaultExportName();

  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await dialog.save({
      title: "导出历史数据",
      defaultPath: filename,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) throw new Error("已取消导出");
    await invoke("write_text_file", { path, contents: text });
    return path;
  } catch (err) {
    if (err instanceof Error && err.message === "已取消导出") throw err;
    // Browser / dialog unavailable
    downloadJson(filename, text);
    return filename;
  }
}

export async function pickAndImportHistory(
  mode: "replace" | "merge",
): Promise<{ count: { tasks: number; repos: number; summaries: number } }> {
  let raw: string | null = null;

  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const selected = await dialog.open({
      title: "导入历史数据",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const path = typeof selected === "string" ? selected : null;
    if (!path) throw new Error("已取消导入");
    raw = (await invoke("read_text_file", { path })) as string;
  } catch (err) {
    if (err instanceof Error && err.message === "已取消导入") throw err;
    raw = await pickFileInBrowser();
    if (raw == null) throw new Error("已取消导入");
  }

  const incoming = parseHistoryBackup(raw);
  const next = await importHistoryDb(incoming, mode);
  return {
    count: {
      tasks: next.tasks.length,
      repos: next.repos.length,
      summaries: next.summaries.length,
    },
  };
}

function pickFileInBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
