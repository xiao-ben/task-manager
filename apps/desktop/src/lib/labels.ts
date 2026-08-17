import type { TaskSource, TaskStatus } from "@task-manager/shared";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "完成",
  cancelled: "取消",
};

export const SOURCE_LABEL: Record<TaskSource, string> = {
  manual: "手动",
  cursor: "Cursor",
  agent: "Agent",
};

export function formatDayTitle(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${m}月${d}日 周${weekday}`;
}
