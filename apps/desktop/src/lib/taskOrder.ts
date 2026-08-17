import type { Task, TaskStatus } from "@task-manager/shared";

const STATUS_RANK: Record<TaskStatus, number> = {
  doing: 0,
  todo: 1,
  done: 2,
  cancelled: 3,
};

/** 进行中置顶 → 未开始 → 完成/取消沉底；同组按更新时间新的在上 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 9;
    const rb = STATUS_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.updatedAt !== b.updatedAt) {
      return a.updatedAt < b.updatedAt ? 1 : -1;
    }
    return a.title.localeCompare(b.title, "zh-CN");
  });
}

export function isOpenStatus(status: TaskStatus): boolean {
  return status === "todo" || status === "doing";
}

/** 单击 checkbox：完成 ↔ 未完成（保留 doing 时点完成会变 done；从 done 回到 todo） */
export function nextCheckboxStatus(status: TaskStatus): TaskStatus {
  if (status === "done" || status === "cancelled") return "todo";
  return "done";
}

export function filterTasksByQuery(
  tasks: Task[],
  query: string,
  status?: TaskStatus | "open" | "all",
): Task[] {
  const q = query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (status === "open" && !isOpenStatus(t.status)) return false;
    if (
      status &&
      status !== "all" &&
      status !== "open" &&
      t.status !== status
    ) {
      return false;
    }
    if (!q) return true;
    const hay = `${t.title}\n${t.notes ?? ""}\n${t.repoPath ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}
