import { useEffect, useMemo, useState } from "react";
import type { Summary, Task } from "@task-manager/shared";
import { monthKey, periodRange, weekKey } from "@task-manager/shared";
import { IconEdit, IconInbox, IconTrash } from "../components/Icons";
import { PeriodNav } from "../components/PeriodNav";
import { DayPickerField } from "../components/DayPickerField";
import { TaskEditor } from "../components/TaskEditor";
import { generateSummaryWithCursor } from "../lib/agent";
import { api } from "../lib/api";
import { SOURCE_LABEL, STATUS_LABEL } from "../lib/labels";
import { nextCheckboxStatus, sortTasks } from "../lib/taskOrder";
import { useToast } from "../lib/toast";
import {
  deleteTaskOptimistic,
  getSummaryLocal,
  pullTasks,
  restoreTaskOptimistic,
  updateTaskOptimistic,
  upsertSummaryLocal,
} from "../lib/sync";

function weekdayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(y, m - 1, d).getDay()];
  return `周${wd}`;
}

export function PeriodPage({ kind }: { kind: "week" | "month" }) {
  const toast = useToast();
  const [periodKey, setPeriodKey] = useState(() =>
    kind === "week" ? weekKey() : monthKey(),
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done").length;
    const doing = tasks.filter((t) => t.status === "doing").length;
    const todo = tasks.filter((t) => t.status === "todo").length;
    return { total: tasks.length, done, doing, todo };
  }, [tasks]);

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    const source = hideDone
      ? tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
      : tasks;
    for (const t of sortTasks(source)) {
      const arr = map.get(t.day) ?? [];
      arr.push(t);
      map.set(t.day, arr);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [tasks, hideDone]);

  async function load() {
    const { from, to } = periodRange(kind, periodKey);
    const list = await pullTasks({ from, to });
    setTasks(sortTasks(list));
    try {
      const res = await getSummaryLocal(kind, periodKey, true);
      setSummary(res.summary);
      setContent(res.summary?.content ?? res.draft ?? "");
    } catch {
      setSummary(null);
      setContent("");
    }
  }

  useEffect(() => {
    setPeriodKey(kind === "week" ? weekKey() : monthKey());
  }, [kind]);

  useEffect(() => {
    setEditingId(null);
    setMsg(null);
    void load();
  }, [kind, periodKey]);

  async function generateDraft() {
    setSummaryBusy(true);
    try {
      const res = await getSummaryLocal(kind, periodKey, true);
      setContent(res.draft ?? "");
      setMsg("已生成模板草稿，记得点击保存");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "生成失败");
    } finally {
      setSummaryBusy(false);
    }
  }

  async function generateAi() {
    setSummaryBusy(true);
    try {
      const res = await generateSummaryWithCursor({
        periodType: kind,
        periodKey,
        tasks,
      });
      setContent(res.draft);
      setMsg("AI 总结已生成（Cursor），记得点击保存");
    } catch (err) {
      try {
        const res = await api.generateAiSummary(kind, periodKey);
        setContent(res.draft);
        setMsg("AI 总结已生成（云端），记得点击保存");
      } catch {
        setMsg(err instanceof Error ? err.message : "AI 总结失败");
      }
    } finally {
      setSummaryBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await upsertSummaryLocal({
        periodType: kind,
        periodKey,
        content,
      });
      setSummary(res);
      setMsg("总结已保存");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(task: Task) {
    await updateTaskOptimistic(task.id, {
      status: nextCheckboxStatus(task.status),
    });
    const { from, to } = periodRange(kind, periodKey);
    setTasks(sortTasks(await pullTasks({ from, to })));
  }

  async function removeTask(task: Task) {
    if (!confirm(`确认删除「${task.title}」？`)) return;
    await deleteTaskOptimistic(task.id);
    await load();
    toast.show({
      message: `已删除「${task.title}」`,
      kind: "ok",
      action: {
        label: "撤销",
        onClick: async () => {
          await restoreTaskOptimistic(task);
          await load();
        },
      },
    });
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div className="hero">
          <span className="seal lg" aria-hidden>
            {kind === "week" ? "周" : "月"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hero-eyebrow">
              {kind === "week" ? "周览 · WEEKLY" : "月览 · MONTHLY"}
            </div>
            <h1 className="display-serif hero-date">
              {kind === "week" ? periodKey : `${periodKey.split("-")[0]}年 ${periodKey.split("-")[1]}月`}
            </h1>
            <div className="hud-stats">
              <span className="stat-chip">
                待办 <b>{stats.todo}</b>
              </span>
              <span className="stat-chip">
                进行中 <b>{stats.doing}</b>
              </span>
              <span className="stat-chip">
                完成 <b>{stats.done}</b>
              </span>
              {summary && (
                <span className="stat-chip">
                  上次更新 {new Date(summary.updatedAt).toLocaleDateString("zh-CN")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <PeriodNav kind={kind} periodKey={periodKey} onChange={setPeriodKey} />
        </div>
      </header>

      {msg && (
        <div className="callout info" role="status">
          {msg}
        </div>
      )}

      {/* 周期总结模块 */}
      <section className="group">
        <div className="group-header">
          <h2 className="headline">
            {kind === "week" ? "周总结文稿" : "月总结文稿"}
          </h2>
          <div className="row">
            <button
              className="btn sm bordered"
              type="button"
              disabled={summaryBusy}
              onClick={() => void generateDraft()}
            >
              模板草稿
            </button>
            <button
              className="btn sm bordered"
              type="button"
              disabled={summaryBusy}
              onClick={() => void generateAi()}
            >
              {summaryBusy ? "生成中…" : "AI 总结"}
            </button>
            <button
              className="btn sm primary"
              type="button"
              disabled={saving || summaryBusy}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存总结"}
            </button>
          </div>
        </div>
        <div className="form-section">
          <textarea
            className="textarea lined"
            style={{ minHeight: 140 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写下本周期的工作复盘与反思，或点击上方「AI 总结」自动提炼…"
            aria-label="周期总结"
          />
        </div>
      </section>

      {/* 周期任务回顾 */}
      <section className="group">
        <div className="group-header">
          <h2 className="headline">周期任务回顾 · {stats.total} 项</h2>
          <button
            className={`btn sm ${hideDone ? "primary" : "bordered"}`}
            type="button"
            onClick={() => setHideDone((v) => !v)}
          >
            {hideDone ? "显示已完成" : "隐藏已完成"}
          </button>
        </div>
        {tasks.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <IconInbox size={22} />
            </div>
            <div className="headline" style={{ fontSize: 14, color: "var(--label)" }}>
              该周期内暂无任务记录
            </div>
            <p className="subhead" style={{ margin: 0 }}>
              可通过上方日历切换到其他周/月
            </p>
          </div>
        ) : (
          <div className="list flush">
            {grouped.map(([day, dayTasks]) => (
              <div className="day-group" key={day}>
                <div className="day-group-head">
                  <span className="day-group-title">
                    {day.slice(5).replace("-", "/")} {weekdayLabel(day)}
                  </span>
                  <span className="day-group-count">
                    {dayTasks.filter((t) => t.status === "done").length}/{dayTasks.length} 完成
                  </span>
                </div>
                {dayTasks.map((t) =>
                  editingId === t.id ? (
                    <TaskEditor
                      key={t.id}
                      task={t}
                      onCancel={() => setEditingId(null)}
                      onDone={() => {
                        setEditingId(null);
                        void load();
                      }}
                    />
                  ) : (
                    <div className={`list-row s-${t.status}`} key={t.id}>
                      <button
                        className={`check ${t.status === "done" ? "on" : t.status === "doing" ? "doing" : ""}`}
                        type="button"
                        aria-pressed={t.status === "done"}
                        aria-label={
                          t.status === "done" || t.status === "cancelled"
                            ? "标记为未完成"
                            : "标记为完成"
                        }
                        onClick={() => void toggleStatus(t)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={`task-title ${t.status === "done" || t.status === "cancelled" ? "done" : ""}`}>
                          {t.title}
                        </div>
                        <div className="task-meta">
                          <span className={`pill ${t.status}`}>
                            {STATUS_LABEL[t.status]}
                          </span>
                          <span>{SOURCE_LABEL[t.source]}</span>
                          {t.notes?.trim() && (
                            <span className="task-notes-preview" title={t.notes}>
                              {t.notes.trim()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="task-actions">
                        <DayPickerField
                          compact
                          value={t.day}
                          onChange={(next) =>
                            void updateTaskOptimistic(t.id, { day: next }).then(
                              () => load(),
                            )
                          }
                        />
                        <button
                          className="btn icon"
                          type="button"
                          title="编辑任务"
                          aria-label="编辑任务"
                          onClick={() => setEditingId(t.id)}
                        >
                          <IconEdit size={15} />
                        </button>
                        <button
                          className="btn icon danger-ghost"
                          type="button"
                          title="删除任务"
                          aria-label="删除任务"
                          onClick={() => void removeTask(t)}
                        >
                          <IconTrash size={15} />
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
