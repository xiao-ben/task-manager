import { useEffect, useState } from "react";
import type { Task, TaskStatus } from "@task-manager/shared";
import { STATUS_LABEL } from "../lib/labels";
import {
  deleteTaskOptimistic,
  updateTaskOptimistic,
} from "../lib/sync";
import { DayPickerField } from "./DayPickerField";
import { IconTrash } from "./Icons";

const statuses: TaskStatus[] = ["todo", "doing", "done", "cancelled"];

type Props = {
  task: Task;
  onDone: (next: Task | null) => void;
  onCancel: () => void;
};

export function TaskEditor({ task, onDone, onCancel }: Props) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [day, setDay] = useState(task.day);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError("日期格式无效");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateTaskOptimistic(task.id, {
        title: title.trim(),
        notes: notes.trim() ? notes.trim() : null,
        status,
        day,
      });
      onDone(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("确认删除这条任务？")) return;
    setBusy(true);
    try {
      await deleteTaskOptimistic(task.id);
      onDone(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // re-bind when form fields change so Cmd+Enter saves latest values
  }, [title, notes, day, status, busy]);

  return (
    <div className="task-editor">
      <div className="task-editor-grid">
        <label className="field span-full">
          <span className="field-label">标题</span>
          <textarea
            className="textarea title-area"
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="任务标题…"
            aria-label="任务标题"
          />
        </label>
        <DayPickerField
          value={day}
          onChange={setDay}
          label="日期"
          showTodayQuick={false}
        />
        <label className="field">
          <span className="field-label">状态</span>
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            aria-label="任务状态"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-full">
          <span className="field-label">备注</span>
          <textarea
            className="textarea"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="可选备注…"
            aria-label="任务备注"
          />
        </label>
      </div>
      {error && (
        <div className="callout err" role="alert">
          {error}
        </div>
      )}
      <div className="task-editor-actions">
        <button
          className="btn danger-ghost"
          type="button"
          disabled={busy}
          onClick={() => void remove()}
        >
          <IconTrash size={14} /> 删除
        </button>
        <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
          <button className="btn bordered" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
