import { useState } from "react";
import type { PeriodType } from "@task-manager/shared";
import {
  periodRange,
  shiftPeriodKey,
  todayKey,
  weekKey,
  monthKey,
} from "@task-manager/shared";
import { CalendarPopover } from "./CalendarPopover";
import { IconChevronLeft, IconChevronRight } from "./Icons";

type Props = {
  kind: PeriodType;
  periodKey: string;
  onChange: (key: string) => void;
};

function fmtDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日`;
}

function labelFor(kind: PeriodType, key: string): string {
  if (kind === "day") {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const wd = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
    return `${y}年${m}月${d}日 周${wd}`;
  }
  if (kind === "week") {
    const { from, to } = periodRange("week", key);
    return `${fmtDay(from)} – ${fmtDay(to)} · ${key}`;
  }
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

export function PeriodNav({ kind, periodKey, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current =
    kind === "day" ? todayKey() : kind === "week" ? weekKey() : monthKey();
  const isCurrent = periodKey === current;

  return (
    <div className="period-nav" role="group" aria-label="周期切换">
      <button
        className="period-nav-arrow"
        type="button"
        aria-label="上一周期"
        onClick={() => onChange(shiftPeriodKey(kind, periodKey, -1))}
      >
        <IconChevronLeft size={15} />
      </button>

      <div className="period-nav-anchor">
        <button
          className="period-nav-value"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="打开日历"
          onClick={() => setOpen((o) => !o)}
        >
          {labelFor(kind, periodKey)}
        </button>
        {open && (
          <CalendarPopover
            kind={kind}
            periodKey={periodKey}
            onSelect={onChange}
            onClose={() => setOpen(false)}
          />
        )}
      </div>

      <button
        className="period-nav-arrow"
        type="button"
        aria-label="下一周期"
        onClick={() => onChange(shiftPeriodKey(kind, periodKey, 1))}
      >
        <IconChevronRight size={15} />
      </button>

      {!isCurrent && (
        <button
          className="period-nav-today"
          type="button"
          onClick={() => onChange(current)}
        >
          {kind === "day" ? "回到今天" : kind === "week" ? "回到本周" : "回到本月"}
        </button>
      )}
    </div>
  );
}
