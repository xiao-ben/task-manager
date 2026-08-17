import { useEffect, useMemo, useState } from "react";
import type { Task } from "@task-manager/shared";
import { addDays, todayKey } from "@task-manager/shared";
import { DayPickerField } from "../components/DayPickerField";
import {
  IconClose,
  IconFolder,
  IconInbox,
  IconPlus,
  IconPlay,
  IconTrash,
} from "../components/Icons";
import {
  listCursorWorkspaces,
  startAgent,
  type CursorWorkspace,
} from "../lib/agent";
import { subscribeLocalDbWatch } from "../lib/dbWatch";
import { STATUS_LABEL } from "../lib/labels";
import { displayName, pickDirectory } from "../lib/picker";
import {
  isOpenStatus,
  nextCheckboxStatus,
  sortTasks,
} from "../lib/taskOrder";
import { useToast } from "../lib/toast";
import {
  createTaskOptimistic,
  deleteTaskOptimistic,
  getCachedTasks,
  listReposLocal,
  pullTasks,
  restoreTaskOptimistic,
  subscribeSync,
  updateTaskOptimistic,
  upsertRepoLocal,
} from "../lib/sync";
import { updateTrayBadge } from "../lib/tray";

async function hideWidget() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_widget");
  } catch {
    window.close();
  }
}

async function openMain() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_main");
  } catch {
    window.location.hash = "#/";
  }
}

async function startWindowDrag(e: React.PointerEvent<HTMLElement>) {
  const target = e.target as HTMLElement | null;
  if (target?.closest("button, a, input, select, textarea, label")) return;
  if (e.button !== 0) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch {
    /* 浏览器预览无窗口拖动 */
  }
}

export function WidgetPage() {
  const toast = useToast();
  const day = todayKey();
  const [tasks, setTasks] = useState<Task[]>(() => sortTasks(getCachedTasks(day)));
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CursorWorkspace[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const openTasks = useMemo(
    () => sortTasks(tasks.filter((t) => isOpenStatus(t.status))),
    [tasks],
  );

  function computeOverdue() {
    const today = todayKey();
    const from = addDays(today, -90);
    setOverdue(
      sortTasks(
        getCachedTasks().filter(
          (t) => isOpenStatus(t.status) && t.day < today && t.day >= from,
        ),
      ),
    );
  }

  function refreshLists(list?: Task[]) {
    const dayTasks = list ?? getCachedTasks(day);
    setTasks(sortTasks(dayTasks));
    computeOverdue();
    const open = dayTasks.filter((t) => isOpenStatus(t.status)).length;
    void updateTrayBadge(open);
  }

  useEffect(() => {
    document.documentElement.classList.add("widget-mode");
    return () => document.documentElement.classList.remove("widget-mode");
  }, []);

  useEffect(() => {
    void pullTasks({ day }).then((list) => refreshLists(list));
    void pullTasks({
      from: addDays(todayKey(), -90),
      to: addDays(todayKey(), -1),
    }).then(() => computeOverdue());

    const onFocusOrVisible = () => {
      if (document.visibilityState === "hidden") return;
      void pullTasks({ day }).then((list) => refreshLists(list));
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    const unsub = subscribeSync(() => refreshLists());
    const unwatch = subscribeLocalDbWatch(() => {
      void pullTasks({ day }).then((list) => refreshLists(list));
    });
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      unsub();
      unwatch();
    };
  }, [day]);

  async function add() {
    if (!title.trim()) return;
    await createTaskOptimistic({ title: title.trim(), day });
    setTitle("");
    refreshLists();
  }

  async function toggleDone(task: Task) {
    await updateTaskOptimistic(task.id, {
      status: nextCheckboxStatus(task.status),
    });
    refreshLists();
  }

  async function removeTask(task: Task) {
    if (!confirm(`删除「${task.title}」？`)) return;
    await deleteTaskOptimistic(task.id);
    refreshLists();
    toast.show({
      message: `已删除「${task.title}」`,
      kind: "ok",
      action: {
        label: "撤销",
        onClick: async () => {
          await restoreTaskOptimistic(task);
          refreshLists();
        },
      },
    });
  }

  async function reschedule(task: Task, nextDay: string) {
    if (task.day === nextDay) return;
    await updateTaskOptimistic(task.id, { day: nextDay });
    refreshLists();
  }

  async function bindPath(task: Task, path: string, name?: string) {
    await upsertRepoLocal({ name: name ?? displayName(path), path });
    await updateTaskOptimistic(task.id, { repoPath: path });
    refreshLists();
    setPickerFor(null);
    setError(null);
  }

  async function openWorkspacePicker(task: Task) {
    if (pickerFor === task.id) {
      setPickerFor(null);
      return;
    }
    const path = await pickDirectory();
    if (path) {
      try {
        await bindPath(task, path);
      } catch (err) {
        setError(err instanceof Error ? err.message : "绑定失败");
      }
      return;
    }
    setPickerLoading(true);
    setPickerFor(task.id);
    setError(null);
    try {
      const list = await listCursorWorkspaces();
      const usable = list.filter((w) => w.exists);
      setCandidates(usable);
      if (usable.length === 0) {
        setError("没有可用的 Cursor 最近工作区");
        setPickerFor(null);
      }
    } catch {
      setError("读取 Cursor 工作区失败：请确认 Sidecar 已运行");
      setPickerFor(null);
    } finally {
      setPickerLoading(false);
    }
  }

  async function launch(task: Task) {
    try {
      setError(null);
      let repoPath = task.repoPath;
      if (!repoPath) {
        const repos = await listReposLocal();
        repoPath = repos[0]?.path ?? null;
      }
      if (!repoPath) {
        await openWorkspacePicker(task);
        return;
      }
      const result = await startAgent({
        taskId: task.id,
        prompt: `请完成以下任务：${task.title}${task.notes ? `\n\n备注：${task.notes}` : ""}`,
        cwd: repoPath,
      });
      await updateTaskOptimistic(task.id, {
        status: "doing",
        repoPath,
        cursorAgentId: result.agentId,
      });
      refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
    }
  }

  function renderTask(task: Task, opts?: { overdue?: boolean }) {
    return (
      <div key={task.id}>
        <div className="widget-task">
          <button
            className={`check ${task.status === "done" ? "on" : task.status === "doing" ? "doing" : ""}`}
            type="button"
            aria-pressed={task.status === "done"}
            aria-label={
              task.status === "done" || task.status === "cancelled"
                ? "标记为未完成"
                : "标记为完成"
            }
            onClick={() => void toggleDone(task)}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="task-title">{task.title}</div>
            <div className="task-meta">
              {opts?.overdue && <span className="pill warn">{task.day}</span>}
              <span className={`pill ${task.status}`}>
                {STATUS_LABEL[task.status]}
              </span>
              {task.repoPath && (
                <span className="path-mono" title={task.repoPath}>
                  {displayName(task.repoPath)}
                </span>
              )}
            </div>
          </div>
          {opts?.overdue ? (
            <button
              className="btn sm bordered"
              type="button"
              onClick={() => void reschedule(task, todayKey())}
            >
              今天
            </button>
          ) : (
            <DayPickerField
              compact
              value={task.day}
              onChange={(next) => void reschedule(task, next)}
            />
          )}
          <button
            className="btn icon bordered"
            type="button"
            title="选择目录"
            aria-label="选择目录或工作区"
            onClick={() => void openWorkspacePicker(task)}
          >
            <IconFolder size={12} />
          </button>
          <button
            className="btn icon bordered"
            type="button"
            title="派发 Agent"
            aria-label="在 Cursor 启动"
            onClick={() => void launch(task)}
          >
            <IconPlay size={12} />
          </button>
          <button
            className="btn icon danger-ghost"
            type="button"
            title="删除"
            aria-label="删除任务"
            onClick={() => void removeTask(task)}
          >
            <IconTrash size={12} />
          </button>
        </div>
        {pickerFor === task.id && (
          <div className="widget-picker">
            <div className="subhead" style={{ padding: "6px 8px" }}>
              {pickerLoading
                ? "读取 Cursor 最近工作区…"
                : "从 Cursor 最近打开中选择"}
            </div>
            {!pickerLoading &&
              candidates.slice(0, 10).map((w) => (
                <button
                  key={w.path}
                  className="widget-picker-item"
                  type="button"
                  onClick={() => void bindPath(task, w.path, w.name)}
                >
                  <span>{w.name}</span>
                  {w.kind === "workspace" && (
                    <span className="pill neutral">工作区</span>
                  )}
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="widget">
      <div className="widget-card rise">
        <div
          className="widget-header"
          data-tauri-drag-region
          onPointerDown={(e) => void startWindowDrag(e)}
        >
          <span className="seal" aria-hidden data-tauri-drag-region>
            今
          </span>
          <strong className="display-serif widget-title" data-tauri-drag-region>
            今日
          </strong>
          <span className="pill" data-tauri-drag-region>
            {openTasks.length}
          </span>
          <div className="spacer" data-tauri-drag-region />
          <button
            className="btn plain sm"
            type="button"
            onClick={() => void openMain()}
          >
            主界面
          </button>
          <button
            className="btn icon bordered widget-close"
            type="button"
            title="关闭小窗"
            aria-label="关闭小窗"
            onClick={() => void hideWidget()}
          >
            <IconClose size={13} />
          </button>
        </div>

        <div className="composer">
          <input
            className="input"
            placeholder="快速添加…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            aria-label="快速添加待办"
          />
          <button
            className="btn primary icon"
            type="button"
            aria-label="添加"
            onClick={() => void add()}
          >
            <IconPlus size={16} />
          </button>
        </div>

        {error && (
          <div className="callout err" role="alert">
            {error}
          </div>
        )}

        {overdue.length > 0 && (
          <div className="widget-overdue">
            <div className="widget-section-title">
              逾期 · {overdue.length}
              <button
                className="btn sm plain"
                type="button"
                onClick={() => {
                  void (async () => {
                    for (const t of overdue) {
                      await updateTaskOptimistic(t.id, { day: todayKey() });
                    }
                    refreshLists();
                  })();
                }}
              >
                全部移到今天
              </button>
            </div>
            {overdue.slice(0, 5).map((t) => renderTask(t, { overdue: true }))}
          </div>
        )}

        <div className="widget-list">
          {openTasks.length === 0 ? (
            <div className="empty" style={{ padding: "20px 8px" }}>
              <div className="empty-icon">
                <IconInbox size={18} />
              </div>
              <div className="headline" style={{ fontSize: 14 }}>
                暂无未完成待办
              </div>
              <p className="subhead" style={{ margin: 0 }}>
                在上方快速添加，或打开主界面查看全部
              </p>
            </div>
          ) : (
            openTasks.map((task) => renderTask(task))
          )}
        </div>
      </div>
    </div>
  );
}
