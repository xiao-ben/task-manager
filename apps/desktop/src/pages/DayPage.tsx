import { useEffect, useMemo, useRef, useState, Fragment, startTransition } from "react";
import { useSearchParams } from "react-router-dom";
import type { AgentRun, Task, TaskStatus } from "@task-manager/shared";
import { addDays, todayKey } from "@task-manager/shared";
import { DayPickerField } from "../components/DayPickerField";
import { PeriodNav } from "../components/PeriodNav";
import { TaskBoard } from "../components/TaskBoard";
import { TaskEditModal } from "../components/TaskEditModal";
import { TaskEditor } from "../components/TaskEditor";
import { TaskMoreMenu } from "../components/TaskMoreMenu";
import {
  IconAgent,
  IconBoard,
  IconEdit,
  IconExternal,
  IconFolder,
  IconInbox,
  IconList,
  IconPlay,
  IconRefresh,
  IconTrash,
} from "../components/Icons";
import {
  generateSummaryWithCursor,
  listCursorWorkspaces,
  startAgent,
  type CursorWorkspace,
} from "../lib/agent";
import { api } from "../lib/api";
import { subscribeLocalDbWatch } from "../lib/dbWatch";
import {
  loadDayViewPrefs,
  saveDayViewPrefs,
  type DayBoardGroupBy,
  type DayViewMode,
} from "../lib/dayView";
import { formatDayTitle, SOURCE_LABEL, STATUS_LABEL } from "../lib/labels";
import { openInCursor } from "../lib/opencursor";
import { displayName, pickDirectory } from "../lib/picker";
import {
  isOpenStatus,
  nextCheckboxStatus,
  sortTasks,
} from "../lib/taskOrder";
import { useToast } from "../lib/toast";
import { formatTranscript } from "../lib/transcript";
import {
  createTaskOptimistic,
  deleteTaskOptimistic,
  getCachedTasks,
  getSummaryLocal,
  listAgentRunsLocal,
  listReposLocal,
  pullTasks,
  restoreTaskOptimistic,
  subscribeSync,
  updateTaskOptimistic,
  upsertRepoLocal,
  upsertSummaryLocal,
} from "../lib/sync";
import { updateTrayBadge } from "../lib/tray";

function isOpenTask(task: Task) {
  return isOpenStatus(task.status);
}

export function DayPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [day, setDay] = useState(() => {
    const q = params.get("day");
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayKey();
  });
  const isToday = day === todayKey();
  const [tasks, setTasks] = useState<Task[]>(() => sortTasks(getCachedTasks(day)));
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | TaskStatus>(
    "all",
  );
  const [viewMode, setViewMode] = useState<DayViewMode>(
    () => loadDayViewPrefs().mode,
  );
  const [boardGroupBy, setBoardGroupBy] = useState<DayBoardGroupBy>(
    () => loadDayViewPrefs().groupBy,
  );
  const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>(
    [],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"info" | "err">("info");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CursorWorkspace[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const openCount = useMemo(
    () => tasks.filter((t) => t.status === "todo" || t.status === "doing").length,
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const sorted = sortTasks(tasks);
    if (statusFilter === "all") return sorted;
    if (statusFilter === "open") return sorted.filter((t) => isOpenTask(t));
    return sorted.filter((t) => t.status === statusFilter);
  }, [tasks, statusFilter]);

  function flash(message: string, kind: "info" | "err" = "info") {
    setMsg(message);
    setMsgKind(kind);
  }

  function syncTasksFromCache() {
    setTasks(sortTasks(getCachedTasks(day)));
    computeOverdueFromCache();
  }

  const doneCount = useMemo(
    () => tasks.filter((t) => t.status === "done").length,
    [tasks],
  );

  const trackTotal = useMemo(
    () => tasks.filter((t) => t.status !== "cancelled").length,
    [tasks],
  );

  useEffect(() => {
    if (isToday) void updateTrayBadge(openCount);
  }, [openCount, isToday]);

  async function refresh() {
    const list = await pullTasks({ day });
    setTasks(sortTasks(list));
    try {
      const res = await getSummaryLocal("day", day, true);
      setSummary(res.summary?.content ?? res.draft ?? "");
    } catch {
      /* ignore */
    }
  }

  function computeOverdueFromCache() {
    if (day !== todayKey()) {
      setOverdue([]);
      return;
    }
    const today = todayKey();
    const from = addDays(today, -90);
    setOverdue(
      getCachedTasks()
        .filter(
          (t) => isOpenTask(t) && t.day < today && t.day >= from,
        )
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
    );
  }

  async function refreshOverdue() {
    if (day !== todayKey()) {
      setOverdue([]);
      return;
    }
    // Prefer in-memory filter; only hit disk when memory is cold
    if (!getCachedTasks().length) {
      await pullTasks({ from: addDays(todayKey(), -90), to: addDays(todayKey(), -1) });
    }
    computeOverdueFromCache();
  }

  async function rescheduleTask(task: Task, nextDay: string) {
    if (task.day === nextDay) return;
    await updateTaskOptimistic(task.id, { day: nextDay });
    syncTasksFromCache();
    await refreshOverdue();
    flash(
      nextDay === todayKey()
        ? `已将「${task.title}」移到今天`
        : `已将「${task.title}」改到 ${nextDay}`,
    );
  }

  useEffect(() => {
    const q = params.get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q !== day) {
      setDay(q);
    }
    const focus = params.get("focus");
    if (focus) {
      window.setTimeout(() => {
        document
          .querySelector(`[data-task-id="${focus}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 120);
      const next = new URLSearchParams(params);
      next.delete("focus");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL
  }, [params]);

  useEffect(() => {
    setEditingId(null);
    setMenuFor(null);
    setTasks(sortTasks(getCachedTasks(day)));
    void refresh();
    void refreshOverdue();
    void listReposLocal().then(setRepos).catch(() => {});

    const onFocusOrVisible = () => {
      if (document.visibilityState === "hidden") return;
      void pullTasks({ day }).then((list) => {
        setTasks(sortTasks(list));
        computeOverdueFromCache();
      });
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    const unsub = subscribeSync(() => {
      startTransition(() => syncTasksFromCache());
    });
    const unwatch = subscribeLocalDbWatch(() => {
      void pullTasks({ day }).then((list) => {
        startTransition(() => {
          setTasks(sortTasks(list));
          computeOverdueFromCache();
        });
      });
    });
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      unsub();
      unwatch();
    };
  }, [day]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
      if (e.key === "[" && !typing) {
        e.preventDefault();
        setDay((d) => addDays(d, -1));
        return;
      }
      if (e.key === "]" && !typing) {
        e.preventDefault();
        setDay((d) => addDays(d, 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await createTaskOptimistic({ title: title.trim(), day });
    setTitle("");
    syncTasksFromCache();
  }

  async function generateTemplateDraft() {
    setSummaryBusy(true);
    try {
      const r = await getSummaryLocal("day", day, true);
      setSummary(r.draft ?? "");
      setSummaryMsg("已生成模板草稿");
    } catch (err) {
      setSummaryMsg(err instanceof Error ? err.message : "生成失败");
    } finally {
      setSummaryBusy(false);
    }
  }

  async function generateAiDraft() {
    setSummaryBusy(true);
    try {
      const r = await generateSummaryWithCursor({
        periodType: "day",
        periodKey: day,
        tasks,
      });
      setSummary(r.draft);
      setSummaryMsg("AI 总结已生成（Cursor），记得保存");
    } catch (err) {
      // sidecar 不可用时退回云端 AI 接口
      try {
        const r = await api.generateAiSummary("day", day);
        setSummary(r.draft);
        setSummaryMsg("AI 总结已生成（云端），记得保存");
      } catch {
        setSummaryMsg(err instanceof Error ? err.message : "AI 总结失败");
      }
    } finally {
      setSummaryBusy(false);
    }
  }

  async function toggleStatus(task: Task) {
    const next = nextCheckboxStatus(task.status);
    await updateTaskOptimistic(task.id, { status: next });
    syncTasksFromCache();
  }

  async function setTaskStatus(task: Task, status: TaskStatus) {
    await updateTaskOptimistic(task.id, { status });
    setMenuFor(null);
    syncTasksFromCache();
  }

  async function bindRepo(task: Task, path: string, name?: string) {
    await upsertRepoLocal({ name: name ?? displayName(path), path });
    setRepos(await listReposLocal());
    await updateTaskOptimistic(task.id, { repoPath: path });
    setPickerFor(null);
    setMsg(null);
    syncTasksFromCache();
  }

  async function removeTask(task: Task) {
    if (!confirm(`确认删除「${task.title}」？`)) return;
    await deleteTaskOptimistic(task.id);
    syncTasksFromCache();
    toast.show({
      message: `已删除「${task.title}」`,
      kind: "ok",
      action: {
        label: "撤销",
        onClick: async () => {
          await restoreTaskOptimistic(task);
          syncTasksFromCache();
        },
      },
    });
  }

  async function onPickRepo(task: Task) {
    if (pickerFor === task.id) {
      setPickerFor(null);
      return;
    }
    // Tauri 原生环境：直接弹系统目录选择器
    const path = await pickDirectory();
    if (path) {
      try {
        await bindRepo(task, path);
      } catch (err) {
        flash(err instanceof Error ? err.message : "绑定目录失败", "err");
      }
      return;
    }
    // 浏览器模式降级：自动拉取 Cursor 最近打开的目录供选择
    setPickerLoading(true);
    setPickerFor(task.id);
    setMsg(null);
    try {
      const list = await listCursorWorkspaces();
      setCandidates(list.filter((w) => w.exists));
      if (list.filter((w) => w.exists).length === 0) {
        flash("Cursor 里没有可用的最近目录，请到设置页手动添加", "err");
        setPickerFor(null);
      }
    } catch {
      setPickerFor(null);
      flash("读取 Cursor 目录失败：请到设置页确认 Sidecar 已运行，或手动添加目录", "err");
    } finally {
      setPickerLoading(false);
    }
  }

  async function toggleRuns(task: Task) {
    if (runsFor === task.id) {
      setRunsFor(null);
      return;
    }
    setRunsFor(task.id);
    setRunsLoading(true);
    setOpenTranscript(null);
    try {
      const list = await listAgentRunsLocal(task.id);
      setRuns(list);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }

  async function onStartAgent(task: Task) {
    const repoPath = task.repoPath || (repos[0]?.path ?? "");
    if (!repoPath) {
      await onPickRepo(task);
      return;
    }
    setBusyId(task.id);
    setMsg(null);
    try {
      if (!task.repoPath) {
        await updateTaskOptimistic(task.id, { repoPath });
      }
      const result = await startAgent({
        taskId: task.id,
        prompt: `请完成以下任务：${task.title}${task.notes ? `\n\n备注：${task.notes}` : ""}`,
        cwd: repoPath,
      });
      await updateTaskOptimistic(task.id, {
        status: "doing",
        cursorAgentId: result.agentId,
        repoPath,
      });
      flash(`Agent 已启动：${result.agentId}`);
      syncTasksFromCache();
      setRunsFor(task.id);
      // sidecar 已写入本地 agentRuns；稍后再读一次覆盖完成态
      void listAgentRunsLocal(task.id).then(setRuns);
      window.setTimeout(() => {
        void listAgentRunsLocal(task.id).then(setRuns);
        syncTasksFromCache();
      }, 2500);
    } catch (err) {
      flash(err instanceof Error ? err.message : "启动失败", "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div className="hero">
          <span className="seal lg" aria-hidden>
            今
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hero-eyebrow-row">
              <span className="hero-eyebrow">{isToday ? "今日 · TODAY" : "历史 · ARCHIVE"}</span>
              {!isToday && <span className="pill neutral">历史日期</span>}
            </div>
            <div className="hero-title-row">
              <h1 className="display-serif hero-date">{formatDayTitle(day)}</h1>
            </div>
            <div className="hud-stats">
              <span className="stat-chip">
                待办 <b>{tasks.filter((t) => t.status === "todo").length}</b>
              </span>
              <span className="stat-chip">
                进行中 <b>{tasks.filter((t) => t.status === "doing").length}</b>
              </span>
              <span className="stat-chip">
                完成 <b>{doneCount}</b>
              </span>
            </div>
            <div className="streak" aria-label={`完成 ${doneCount} / ${trackTotal}`}>
              <div
                className="streak-fill"
                style={{
                  width: trackTotal > 0 ? `${(doneCount / trackTotal) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <PeriodNav kind="day" periodKey={day} onChange={setDay} />
          <button
            className="btn bordered icon"
            type="button"
            aria-label="刷新"
            onClick={() => void refresh()}
          >
            <IconRefresh size={15} />
          </button>
        </div>
      </header>

      <form className="composer" onSubmit={(e) => void onAdd(e)}>
        <textarea
          ref={composerRef}
          className="textarea composer-input"
          rows={2}
          placeholder={isToday ? "添加今日待办…（N 聚焦，⌘↵ 添加）" : `添加 ${day} 待办…`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void onAdd(e);
            }
          }}
          aria-label="新待办"
        />
        <button className="btn primary" type="submit">
          添加
        </button>
      </form>

      {msg && (
        <div className={`callout ${msgKind === "err" ? "err" : "info"}`} role="status">
          {msg}
        </div>
      )}

      {isToday && overdue.length > 0 && (
        <section className="group overdue-group">
          <div className="group-header">
            <h2 className="headline">往日未完成 · {overdue.length}</h2>
            <button
              className="btn bordered"
              type="button"
              onClick={() => {
                void (async () => {
                  const today = todayKey();
                  for (const t of overdue) {
                    await updateTaskOptimistic(t.id, { day: today });
                  }
                  syncTasksFromCache();
                  await refreshOverdue();
                  flash(`已将 ${overdue.length} 条往日未完成移到今天`);
                })();
              }}
            >
              全部移到今天
            </button>
          </div>
          <div className="list">
            {overdue.map((task) =>
              editingId === task.id ? (
                <TaskEditor
                  key={task.id}
                  task={task}
                  onCancel={() => startTransition(() => setEditingId(null))}
                  onDone={() => {
                    startTransition(() => {
                      setEditingId(null);
                      syncTasksFromCache();
                    });
                  }}
                />
              ) : (
                <div className={`list-row s-${task.status}`} key={task.id}>
                  <button
                    className={`check ${task.status === "doing" ? "doing" : ""}`}
                    type="button"
                    aria-label="标记为完成"
                    onClick={() =>
                      void updateTaskOptimistic(task.id, { status: "done" }).then(
                        () => refreshOverdue(),
                      )
                    }
                  />
                  <div>
                    <div className="task-title">{task.title}</div>
                    <div className="task-meta">
                      <span className="pill warn">{task.day}</span>
                      <span className={`pill ${task.status}`}>
                        {STATUS_LABEL[task.status]}
                      </span>
                      {task.notes?.trim() && (
                        <span className="task-notes-preview" title={task.notes}>
                          {task.notes.trim()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="task-actions">
                    <button
                      className="btn bordered"
                      type="button"
                      onClick={() => void rescheduleTask(task, todayKey())}
                    >
                      移到今天
                    </button>
                    <DayPickerField
                      compact
                      value={task.day}
                      onChange={(next) => void rescheduleTask(task, next)}
                    />
                    <button
                      className="btn icon"
                      type="button"
                      title="编辑任务"
                      aria-label="编辑任务"
                      onClick={() =>
                        startTransition(() => setEditingId(task.id))
                      }
                    >
                      <IconEdit size={15} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      <section className="group">
        <div className="group-header">
          <h2 className="headline">
            {viewMode === "board" ? "看板" : "待办列表"} ·{" "}
            {viewMode === "board" ? tasks.length : visibleTasks.length}
          </h2>
          <div className="row filter-row">
            <div className="seg" role="group" aria-label="视图切换">
              <button
                type="button"
                className={`seg-item icon ${viewMode === "list" ? "active" : ""}`}
                title="列表视图"
                aria-label="列表视图"
                aria-pressed={viewMode === "list"}
                onClick={() => {
                  setViewMode("list");
                  saveDayViewPrefs({ mode: "list" });
                }}
              >
                <IconList size={14} />
              </button>
              <button
                type="button"
                className={`seg-item icon ${viewMode === "board" ? "active" : ""}`}
                title="看板视图"
                aria-label="看板视图"
                aria-pressed={viewMode === "board"}
                onClick={() => {
                  setViewMode("board");
                  saveDayViewPrefs({ mode: "board" });
                }}
              >
                <IconBoard size={14} />
              </button>
            </div>
            {viewMode === "board" ? (
              <div className="seg" role="group" aria-label="分组方式">
                <button
                  type="button"
                  className={`seg-item ${boardGroupBy === "status" ? "active" : ""}`}
                  aria-pressed={boardGroupBy === "status"}
                  onClick={() => {
                    setBoardGroupBy("status");
                    saveDayViewPrefs({ groupBy: "status" });
                  }}
                >
                  状态
                </button>
                <button
                  type="button"
                  className={`seg-item ${boardGroupBy === "workspace" ? "active" : ""}`}
                  aria-pressed={boardGroupBy === "workspace"}
                  onClick={() => {
                    setBoardGroupBy("workspace");
                    saveDayViewPrefs({ groupBy: "workspace" });
                  }}
                >
                  工作区
                </button>
              </div>
            ) : (
              <div className="seg" role="group" aria-label="状态筛选">
                {(
                  [
                    ["all", "全部"],
                    ["open", "未完成"],
                    ["doing", "进行中"],
                    ["done", "完成"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`seg-item ${statusFilter === key ? "active" : ""}`}
                    aria-pressed={statusFilter === key}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {tasks.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <IconInbox size={22} />
            </div>
            <div className="headline" style={{ fontSize: 15, color: "var(--label)" }}>
              {isToday ? "今天还没有任务" : "这一天没有任务"}
            </div>
            <p className="subhead" style={{ margin: 0 }}>
              在上方输入，或用日历切换到其他日期
            </p>
          </div>
        ) : viewMode === "list" && visibleTasks.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <IconInbox size={22} />
            </div>
            <div className="headline" style={{ fontSize: 15, color: "var(--label)" }}>
              没有符合筛选的任务
            </div>
            <p className="subhead" style={{ margin: 0 }}>
              试试切换筛选条件
            </p>
          </div>
        ) : viewMode === "board" ? (
          <TaskBoard
            tasks={sortTasks(tasks)}
            repos={repos}
            groupBy={boardGroupBy}
            busyId={busyId}
            onMoveStatus={async (task, status) => {
              await updateTaskOptimistic(task.id, { status });
              syncTasksFromCache();
            }}
            onMoveWorkspace={async (task, repoPath) => {
              await updateTaskOptimistic(task.id, { repoPath });
              syncTasksFromCache();
            }}
            onOpenTask={(task) =>
              startTransition(() => setEditingId(task.id))
            }
            onStartAgent={(task) => void onStartAgent(task)}
          />
        ) : (
          <div className="list">
            {visibleTasks.map((task) => (
              <Fragment key={task.id}>
              {editingId === task.id ? (
                <TaskEditor
                  task={task}
                  onCancel={() => startTransition(() => setEditingId(null))}
                  onDone={() => {
                    startTransition(() => {
                      setEditingId(null);
                      syncTasksFromCache();
                    });
                  }}
                />
              ) : (
              <div className={`list-row s-${task.status}`} data-task-id={task.id}>
                <button
                  className={`check ${task.status === "done" ? "on" : task.status === "doing" ? "doing" : ""}`}
                  type="button"
                  aria-pressed={task.status === "done"}
                  aria-label={
                    task.status === "done" || task.status === "cancelled"
                      ? "标记为未完成"
                      : "标记为完成"
                  }
                  onClick={() => void toggleStatus(task)}
                />
                <div>
                  <div
                    className={`task-title ${task.status === "done" || task.status === "cancelled" ? "done" : ""}`}
                  >
                    {task.title}
                  </div>
                  <div className="task-meta">
                    <span className={`pill ${task.status}`}>
                      {STATUS_LABEL[task.status]}
                    </span>
                    <span>{SOURCE_LABEL[task.source]}</span>
                    {task.notes?.trim() && (
                      <span className="task-notes-preview" title={task.notes}>
                        {task.notes.trim()}
                      </span>
                    )}
                    {task.repoPath && (
                      <span className="path-mono" title={task.repoPath}>
                        {repos.find((r) => r.path === task.repoPath)?.name ??
                          displayName(task.repoPath)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  <button
                    className="btn icon"
                    type="button"
                    title={busyId === task.id ? "派发中…" : "派发 Agent"}
                    aria-label="派发 Agent 任务"
                    disabled={busyId === task.id}
                    onClick={() => void onStartAgent(task)}
                  >
                    <IconPlay size={15} />
                  </button>
                  {(task.cursorAgentId || task.status === "doing") && (
                    <button
                      className={`btn icon ${runsFor === task.id ? "active" : ""}`}
                      type="button"
                      title="Agent 运行记录"
                      aria-label="查看 Agent 运行记录"
                      onClick={() => void toggleRuns(task)}
                    >
                      <IconAgent size={15} />
                    </button>
                  )}
                  <DayPickerField
                    compact
                    value={task.day}
                    onChange={(next) => void rescheduleTask(task, next)}
                  />
                  <TaskMoreMenu
                    open={menuFor === task.id}
                    onOpenChange={(open) => setMenuFor(open ? task.id : null)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        startTransition(() => setEditingId(task.id));
                      }}
                    >
                      <IconEdit size={14} /> 编辑
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void setTaskStatus(task, "doing")}
                    >
                      标为进行中
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void setTaskStatus(task, "cancelled")}
                    >
                      标为已取消
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        void onPickRepo(task);
                      }}
                    >
                      <IconFolder size={14} /> 选择目录
                    </button>
                    {task.repoPath && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          void openInCursor(task.repoPath!)
                            .then(() => flash("已唤起 Cursor"))
                            .catch((err) =>
                              flash(
                                err instanceof Error
                                  ? err.message
                                  : "唤起 Cursor 失败",
                                "err",
                              ),
                            );
                        }}
                      >
                        <IconExternal size={14} /> 在 Cursor 打开
                      </button>
                    )}
                    {task.status === "doing" && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          void onStartAgent(task);
                        }}
                      >
                        <IconPlay size={14} /> 重新派发
                      </button>
                    )}
                    <label className="more-menu-select">
                      仓库
                      <select
                        className="select compact"
                        value={task.repoPath ?? ""}
                        aria-label="选择仓库"
                        onChange={(e) => {
                          void updateTaskOptimistic(task.id, {
                            repoPath: e.target.value || null,
                          }).then(() => {
                            setMenuFor(null);
                            syncTasksFromCache();
                          });
                        }}
                      >
                        <option value="">未绑定</option>
                        {repos.map((r) => (
                          <option key={r.id} value={r.path}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setMenuFor(null);
                        void removeTask(task);
                      }}
                    >
                      <IconTrash size={14} /> 删除
                    </button>
                  </TaskMoreMenu>
                </div>
              </div>
              )}
              {pickerFor === task.id && (
                <div className="repo-picker">
                  <div className="repo-picker-title subhead">
                    {pickerLoading
                      ? "读取 Cursor 最近目录…"
                      : `从 Cursor 最近打开中选择 · ${candidates.length} 项`}
                  </div>
                  {!pickerLoading &&
                    candidates.slice(0, 12).map((w) => (
                      <button
                        key={w.path}
                        className="repo-picker-item"
                        type="button"
                        onClick={() => void bindRepo(task, w.path, w.name)}
                      >
                        <span className="headline" style={{ fontSize: 14 }}>
                          {w.name}
                        </span>
                        {w.kind === "workspace" && (
                          <span className="pill neutral">工作区</span>
                        )}
                        <span className="path-mono">{w.path}</span>
                      </button>
                    ))}
                </div>
              )}
              {runsFor === task.id && (
                <div className="agent-panel">
                  <div className="repo-picker-title subhead">
                    {runsLoading ? "读取运行记录…" : `Agent 运行记录 · ${runs.length} 次`}
                  </div>
                  {!runsLoading && runs.length === 0 && (
                    <div className="subhead" style={{ padding: "10px 14px" }}>
                      暂无记录。派发后会写入本机；开启同步时也会合并云端记录。
                    </div>
                  )}
                  {!runsLoading &&
                    runs.map((r) => (
                      <div className="agent-run" key={r.id}>
                        <div className="agent-run-head">
                          <span className={`pill ${r.status === "done" ? "ok" : r.status === "error" ? "err" : "doing"}`}>
                            {r.status === "done" ? "完成" : r.status === "error" ? "失败" : "运行中"}
                          </span>
                          <span className="subhead">
                            {new Date(r.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                            {r.finishedAt &&
                              ` · 耗时 ${Math.max(1, Math.round((new Date(r.finishedAt).getTime() - new Date(r.createdAt).getTime()) / 1000))}s`}
                          </span>
                          {r.status === "error" && (
                            <button
                              className="btn sm bordered"
                              type="button"
                              onClick={() => void onStartAgent(task)}
                            >
                              重试
                            </button>
                          )}
                          {task.repoPath && (
                            <button
                              className="btn sm plain"
                              type="button"
                              onClick={() =>
                                void openInCursor(task.repoPath!).catch(() => {})
                              }
                            >
                              打开仓库
                            </button>
                          )}
                          {r.transcript && (
                            <button
                              className="btn sm plain"
                              type="button"
                              onClick={() =>
                                setOpenTranscript(openTranscript === r.id ? null : r.id)
                              }
                            >
                              {openTranscript === r.id ? "收起过程" : "查看过程"}
                            </button>
                          )}
                        </div>
                        {r.error && <pre className="agent-pre err">{r.error}</pre>}
                        {r.result && <pre className="agent-pre">{r.result}</pre>}
                        {openTranscript === r.id && r.transcript && (
                          <pre className="agent-pre transcript">
                            {formatTranscript(r.transcript)}
                          </pre>
                        )}
                      </div>
                    ))}
                </div>
              )}
              </Fragment>
            ))}
          </div>
        )}
        {viewMode === "board" && editingId && (() => {
          const task = tasks.find((t) => t.id === editingId);
          if (!task) return null;
          return (
            <TaskEditModal
              task={task}
              onCancel={() => startTransition(() => setEditingId(null))}
              onDone={() => {
                startTransition(() => {
                  setEditingId(null);
                  syncTasksFromCache();
                });
              }}
            />
          );
        })()}
        {viewMode === "board" && pickerFor && (
          <div className="repo-picker" style={{ margin: "10px 0 0" }}>
            <div className="repo-picker-title subhead">
              {pickerLoading
                ? "读取 Cursor 最近目录…"
                : `从 Cursor 最近打开中选择 · ${candidates.length} 项`}
            </div>
            {!pickerLoading &&
              candidates.slice(0, 12).map((w) => {
                const task = tasks.find((t) => t.id === pickerFor);
                if (!task) return null;
                return (
                  <button
                    key={w.path}
                    className="repo-picker-item"
                    type="button"
                    onClick={() => void bindRepo(task, w.path, w.name)}
                  >
                    <span className="headline" style={{ fontSize: 14 }}>
                      {w.name}
                    </span>
                    {w.kind === "workspace" && (
                      <span className="pill neutral">工作区</span>
                    )}
                    <span className="path-mono">{w.path}</span>
                  </button>
                );
              })}
          </div>
        )}
      </section>

      <section className="group">
        <div className="group-header">
          <h2 className="headline">日总结</h2>
          <div className="row">
            <button
              className="btn sm bordered"
              type="button"
              disabled={summaryBusy}
              onClick={() => void generateTemplateDraft()}
            >
              模板草稿
            </button>
            <button
              className="btn sm bordered"
              type="button"
              disabled={summaryBusy}
              onClick={() => void generateAiDraft()}
            >
              {summaryBusy ? "生成中…" : "AI 总结"}
            </button>
            <button
              className="btn sm primary"
              type="button"
              disabled={summaryBusy}
              onClick={() =>
                void upsertSummaryLocal({
                  periodType: "day",
                  periodKey: day,
                  content: summary,
                }).then(() => setSummaryMsg("日总结已保存"))
              }
            >
              保存
            </button>
          </div>
        </div>
        <div className="form-section">
          {summaryMsg && (
            <div className="callout info" role="status">
              {summaryMsg}
            </div>
          )}
          <textarea
            className="textarea lined"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="写下今日进展与反思…"
            aria-label="日总结"
          />
        </div>
      </section>
    </div>
  );
}
