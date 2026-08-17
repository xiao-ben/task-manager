import { useEffect, useRef, useState } from "react";
import type { PeriodType } from "@task-manager/shared";
import {
  monthKey,
  periodKeyFromDay,
  periodRange,
  todayKey,
  weekKey,
} from "@task-manager/shared";
import { api } from "../lib/api";
import { IconChevronLeft, IconChevronRight } from "./Icons";

type Props = {
  kind: PeriodType;
  periodKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
};

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function CalendarPopover({ kind, periodKey, onSelect, onClose }: Props) {
  const anchorDay =
    kind === "month" ? `${periodKey}-01` : kind === "day" ? periodKey : periodRange("week", periodKey).from;
  const [ay, am] = anchorDay.split("-").map(Number);
  const [viewY, setViewY] = useState(ay);
  const [viewM, setViewM] = useState(am);
  const [busyDays, setBusyDays] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 有任务的日期打点（日/周模式）
  useEffect(() => {
    if (kind === "month") return;
    const last = new Date(viewY, viewM, 0).getDate();
    let cancelled = false;
    api
      .listTasks({ from: dayKey(viewY, viewM, 1), to: dayKey(viewY, viewM, last) })
      .then(({ tasks }) => {
        if (!cancelled) setBusyDays(new Set(tasks.map((t) => t.day)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewY, viewM, kind]);

  function shiftMonth(delta: number) {
    const d = new Date(viewY, viewM - 1 + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth() + 1);
  }

  const today = todayKey();

  if (kind === "month") {
    return (
      <div className="cal-pop" ref={ref} role="dialog" aria-label="选择月份">
        <div className="cal-head">
          <button
            className="period-nav-arrow"
            type="button"
            aria-label="上一年"
            onClick={() => setViewY((y) => y - 1)}
          >
            <IconChevronLeft size={14} />
          </button>
          <span className="cal-title">{viewY}年</span>
          <button
            className="period-nav-arrow"
            type="button"
            aria-label="下一年"
            onClick={() => setViewY((y) => y + 1)}
          >
            <IconChevronRight size={14} />
          </button>
        </div>
        <div className="cal-months">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const key = `${viewY}-${pad(m)}`;
            const isSel = key === periodKey;
            const isCur = key === monthKey();
            return (
              <button
                key={m}
                type="button"
                className={`cal-month${isSel ? " sel" : ""}${isCur && !isSel ? " today" : ""}`}
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
              >
                {m}月
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const first = new Date(viewY, viewM - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一起
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(dayKey(viewY, viewM, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const selWeek = kind === "week" ? periodRange("week", periodKey) : null;

  return (
    <div className="cal-pop" ref={ref} role="dialog" aria-label="选择日期">
      <div className="cal-head">
        <button
          className="period-nav-arrow"
          type="button"
          aria-label="上一月"
          onClick={() => shiftMonth(-1)}
        >
          <IconChevronLeft size={14} />
        </button>
        <span className="cal-title">
          {viewY}年{viewM}月
        </span>
        <button
          className="period-nav-arrow"
          type="button"
          aria-label="下一月"
          onClick={() => shiftMonth(1)}
        >
          <IconChevronRight size={14} />
        </button>
      </div>
      <div className="cal-weekdays">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((d, index) => {
          const di = index % 7;
          if (!d) return <span key={`empty-${index}`} className="cal-cell empty" />;

          const isToday = d === today;
          const isSelDay = kind === "day" && d === periodKey;
          const inSelWeek =
            kind === "week" && selWeek && d >= selWeek.from && d <= selWeek.to;
          const has = busyDays.has(d);

          const cls = [
            "cal-cell",
            di >= 5 ? "weekend" : "",
            isSelDay ? "sel" : "",
            inSelWeek ? "week-sel" : "",
            isToday && !isSelDay && !inSelWeek ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={d}
              type="button"
              className={cls}
              aria-label={d}
              onClick={() => {
                onSelect(kind === "week" ? periodKeyFromDay("week", d) : d);
                onClose();
              }}
            >
              <span className="cal-num">{Number(d.slice(8))}</span>
              {has && <span className="cal-dot" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="cal-foot">
        <button
          className="period-nav-today"
          type="button"
          onClick={() => {
            onSelect(kind === "week" ? weekKey() : todayKey());
            onClose();
          }}
        >
          {kind === "week" ? "回到本周" : "回到今天"}
        </button>
      </div>
    </div>
  );
}
