import { useEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskStatus } from "@task-manager/shared";
import { STATUS_LABEL } from "../lib/labels";
import { filterTasksByQuery, sortTasks } from "../lib/taskOrder";
import { getCachedTasks, pullTasks } from "../lib/sync";
import { IconSearch } from "./Icons";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (task: Task) => void;
};

type StatusFilter = "all" | "open" | TaskStatus;

export function SearchPalette({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tasks, setTasks] = useState<Task[]>(() => getCachedTasks());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setStatus("all");
    void pullTasks({}).then((list) => setTasks(list));
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(
    () => sortTasks(filterTasksByQuery(tasks, query, status)).slice(0, 40),
    [tasks, query, status],
  );

  if (!open) return null;

  return (
    <div
      className="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="搜索任务"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="search-panel rise">
        <div className="search-bar">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            className="input search-input"
            placeholder="搜索标题、备注、仓库…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="search-filters" role="group" aria-label="状态过滤">
          {(
            [
              ["all", "全部"],
              ["open", "未完成"],
              ["doing", "进行中"],
              ["todo", "待办"],
              ["done", "完成"],
              ["cancelled", "已取消"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn sm ${status === key ? "primary" : "bordered"}`}
              onClick={() => setStatus(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-results">
          {results.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              <div className="subhead">没有匹配的任务</div>
            </div>
          ) : (
            results.map((t) => (
              <button
                key={t.id}
                type="button"
                className="search-result"
                onClick={() => {
                  onSelect(t);
                  onClose();
                }}
              >
                <span className={`pill ${t.status}`}>{STATUS_LABEL[t.status]}</span>
                <span className="search-result-title">{t.title}</span>
                <span className="path-mono">{t.day}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
