import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { todayKey } from "@task-manager/shared";
import { CalendarPopover } from "./CalendarPopover";
import { IconMonth } from "./Icons";

type Props = {
  value: string;
  onChange: (day: string) => void;
  disabled?: boolean;
  /** compact icon button for list rows */
  compact?: boolean;
  label?: string;
  showTodayQuick?: boolean;
};

function formatShort(day: string) {
  const today = todayKey();
  if (day === today) return "今天";
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

type PopPos = { top: number; left: number };

function usePopoverPosition(open: boolean, anchorRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<PopPos | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const popW = 280;
      const margin = 8;
      let left = rect.right - popW;
      left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));
      let top = rect.bottom + 6;
      const approxH = 320;
      if (top + approxH > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - approxH - 6);
      }
      setPos({ top, left });
    };
    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    update();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, anchorRef]);

  return pos;
}

function FloatingDayPicker({
  value,
  onChange,
  onClose,
  pos,
}: {
  value: string;
  onChange: (day: string) => void;
  onClose: () => void;
  pos: PopPos;
}) {
  return createPortal(
    <div
      className="day-picker-floating"
      style={{ top: pos.top, left: pos.left }}
    >
      <CalendarPopover
        kind="day"
        periodKey={value}
        onSelect={(key) => {
          onChange(key);
          onClose();
        }}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

export function DayPickerField({
  value,
  onChange,
  disabled,
  compact,
  label = "日期",
  showTodayQuick = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const pos = usePopoverPosition(open && !disabled, anchorRef);
  const today = todayKey();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (compact) {
    return (
      <div className="day-picker-wrap">
        <button
          ref={anchorRef}
          className="btn icon"
          type="button"
          disabled={disabled}
          title={`改期 · ${value}`}
          aria-label={`改期，当前 ${value}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconMonth size={15} />
        </button>
        {open && !disabled && pos && (
          <FloatingDayPicker
            value={value}
            onChange={onChange}
            onClose={() => setOpen(false)}
            pos={pos}
          />
        )}
      </div>
    );
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="day-picker-field">
        <button
          ref={anchorRef}
          className="input day-picker-trigger"
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-expanded={open}
          onClick={() => !disabled && setOpen((v) => !v)}
        >
          <IconMonth size={15} />
          <span>{formatShort(value)}</span>
          <span className="day-picker-full">{value}</span>
        </button>
        {showTodayQuick && !disabled && value !== today && (
          <button
            className="btn bordered"
            type="button"
            onClick={() => onChange(today)}
          >
            今天
          </button>
        )}
        {open && !disabled && pos && (
          <FloatingDayPicker
            value={value}
            onChange={onChange}
            onClose={() => setOpen(false)}
            pos={pos}
          />
        )}
      </div>
    </label>
  );
}
