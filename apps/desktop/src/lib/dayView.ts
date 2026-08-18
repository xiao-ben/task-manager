export type DayViewMode = "list" | "board";
export type DayBoardGroupBy = "status" | "workspace";

const KEY = "task-manager.dayView";

export type DayViewPrefs = {
  mode: DayViewMode;
  groupBy: DayBoardGroupBy;
};

const defaults: DayViewPrefs = {
  mode: "list",
  groupBy: "status",
};

export function loadDayViewPrefs(): DayViewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const parsed = { ...defaults, ...JSON.parse(raw) } as DayViewPrefs;
    if (parsed.mode !== "list" && parsed.mode !== "board") parsed.mode = "list";
    if (parsed.groupBy !== "status" && parsed.groupBy !== "workspace") {
      parsed.groupBy = "status";
    }
    return parsed;
  } catch {
    return { ...defaults };
  }
}

export function saveDayViewPrefs(partial: Partial<DayViewPrefs>): DayViewPrefs {
  const next = { ...loadDayViewPrefs(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
