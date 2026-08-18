import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task, TaskStatus } from "@task-manager/shared";
import { STATUS_LABEL, SOURCE_LABEL } from "../lib/labels";
import { displayName } from "../lib/picker";
import { sortTasks } from "../lib/taskOrder";
import { IconEdit, IconPlay } from "./Icons";

export type BoardGroupBy = "status" | "workspace";

const STATUS_COLUMNS: TaskStatus[] = ["todo", "doing", "done", "cancelled"];
const UNBOUND = "__unbound__";
const DRAG_THRESHOLD = 4;

type RepoInfo = { id: string; name: string; path: string };

type Props = {
  tasks: Task[];
  repos: RepoInfo[];
  groupBy: BoardGroupBy;
  busyId?: string | null;
  onMoveStatus: (task: Task, status: TaskStatus) => void | Promise<void>;
  onMoveWorkspace: (task: Task, repoPath: string | null) => void | Promise<void>;
  onOpenTask?: (task: Task) => void;
  onStartAgent?: (task: Task) => void | Promise<void>;
};

type Column = {
  key: string;
  title: string;
  tasks: Task[];
  status?: TaskStatus;
  repoPath?: string | null;
};

type ActiveDrag = {
  taskId: string;
  title: string;
  meta: string;
  width: number;
  offsetX: number;
  offsetY: number;
  fromKey: string;
};

export function TaskBoard({
  tasks,
  repos,
  groupBy,
  busyId,
  onMoveStatus,
  onMoveWorkspace,
  onOpenTask,
  onStartAgent,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [ghost, setGhost] = useState<ActiveDrag | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<ActiveDrag | null>(null);
  const pendingRef = useRef<{
    taskId: string;
    fromKey: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    title: string;
    meta: string;
  } | null>(null);
  const overKeyRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  const tasksRef = useRef(tasks);
  const groupByRef = useRef(groupBy);
  const columnsRef = useRef<Column[]>([]);
  const onMoveStatusRef = useRef(onMoveStatus);
  const onMoveWorkspaceRef = useRef(onMoveWorkspace);
  const onOpenTaskRef = useRef(onOpenTask);

  const columns: Column[] = useMemo(() => {
    const sorted = sortTasks(tasks);
    if (groupBy === "status") {
      return STATUS_COLUMNS.map((status) => ({
        key: status,
        title: STATUS_LABEL[status],
        status,
        tasks: sorted.filter((t) => t.status === status),
      }));
    }
    const paths = new Set<string>();
    for (const t of sorted) {
      if (t.repoPath) paths.add(t.repoPath);
    }
    for (const r of repos) paths.add(r.path);
    const workspaceCols: Column[] = [...paths]
      .sort((a, b) => {
        const na = repos.find((r) => r.path === a)?.name ?? displayName(a);
        const nb = repos.find((r) => r.path === b)?.name ?? displayName(b);
        return na.localeCompare(nb, "zh-CN");
      })
      .map((path) => ({
        key: path,
        title: repos.find((r) => r.path === path)?.name ?? displayName(path),
        repoPath: path,
        tasks: sorted.filter((t) => t.repoPath === path),
      }));
    return [
      {
        key: UNBOUND,
        title: "未绑定",
        repoPath: null,
        tasks: sorted.filter((t) => !t.repoPath),
      },
      ...workspaceCols,
    ];
  }, [tasks, repos, groupBy]);

  tasksRef.current = tasks;
  groupByRef.current = groupBy;
  columnsRef.current = columns;
  onMoveStatusRef.current = onMoveStatus;
  onMoveWorkspaceRef.current = onMoveWorkspace;
  onOpenTaskRef.current = onOpenTask;

  function cardMeta(task: Task): string {
    const bits: string[] = [];
    if (groupBy === "workspace") bits.push(STATUS_LABEL[task.status]);
    if (groupBy === "status" && task.repoPath) {
      bits.push(
        repos.find((r) => r.path === task.repoPath)?.name ??
          displayName(task.repoPath),
      );
    }
    bits.push(SOURCE_LABEL[task.source]);
    return bits.join(" · ");
  }

  function hitColumnKey(clientX: number, clientY: number): string | null {
    const el = document.elementFromPoint(clientX, clientY);
    const col = el?.closest?.("[data-kanban-col]") as HTMLElement | null;
    return col?.dataset.kanbanCol ?? null;
  }

  function placeGhost(clientX: number, clientY: number) {
    const active = activeRef.current;
    const el = ghostElRef.current;
    if (!active || !el) return;
    const x = clientX - active.offsetX;
    const y = clientY - active.offsetY;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(1.25deg) scale(1.03)`;
  }

  function syncOverKey(clientX: number, clientY: number) {
    const next = hitColumnKey(clientX, clientY);
    if (next === overKeyRef.current) return;
    overKeyRef.current = next;
    setOverKey(next);
  }

  async function commitDrop(
    taskId: string,
    targetKey: string | null,
    fromKey: string,
  ) {
    if (!targetKey || targetKey === fromKey) return;
    const task = tasksRef.current.find((t) => t.id === taskId);
    const column = columnsRef.current.find((c) => c.key === targetKey);
    if (!task || !column) return;
    if (
      groupByRef.current === "status" &&
      column.status &&
      task.status !== column.status
    ) {
      await onMoveStatusRef.current(task, column.status);
      return;
    }
    if (groupByRef.current === "workspace") {
      const next = column.repoPath ?? null;
      if (task.repoPath !== next) await onMoveWorkspaceRef.current(task, next);
    }
  }

  useLayoutEffect(() => {
    if (!ghost) return;
    placeGhost(pointerRef.current.x, pointerRef.current.y);
  }, [ghost]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const pending = pendingRef.current;
      const active = activeRef.current;

      if (pending && !active) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        const next: ActiveDrag = {
          taskId: pending.taskId,
          title: pending.title,
          meta: pending.meta,
          width: pending.width,
          offsetX: pending.offsetX,
          offsetY: pending.offsetY,
          fromKey: pending.fromKey,
        };
        pendingRef.current = null;
        activeRef.current = next;
        document.body.classList.add("kanban-dragging");
        setDraggingId(next.taskId);
        setGhost(next);
        overKeyRef.current = hitColumnKey(e.clientX, e.clientY);
        setOverKey(overKeyRef.current);
        return;
      }

      if (!active) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        placeGhost(pointerRef.current.x, pointerRef.current.y);
        syncOverKey(pointerRef.current.x, pointerRef.current.y);
      });
    }

    function onUp(e: PointerEvent) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const pending = pendingRef.current;
      const active = activeRef.current;
      pendingRef.current = null;
      activeRef.current = null;
      overKeyRef.current = null;
      document.body.classList.remove("kanban-dragging");
      setGhost(null);
      setDraggingId(null);
      setOverKey(null);

      if (active) {
        const target = hitColumnKey(e.clientX, e.clientY);
        void commitDrop(active.taskId, target, active.fromKey);
        return;
      }
      if (pending) {
        const task = tasksRef.current.find((t) => t.id === pending.taskId);
        if (task) onOpenTaskRef.current?.(task);
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("kanban-dragging");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function beginDrag(e: React.PointerEvent, task: Task, fromKey: string) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".kanban-action")) return;
    const card = e.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    pointerRef.current = { x: e.clientX, y: e.clientY };
    pendingRef.current = {
      taskId: task.id,
      fromKey,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: Math.round(rect.width),
      title: task.title,
      meta: cardMeta(task),
    };
  }

  return (
    <div
      className={`kanban ${draggingId ? "is-dragging" : ""}`}
      role="list"
      aria-label="看板"
    >
      {columns.map((col) => {
        const isOver = overKey === col.key;
        const showCards = col.tasks.filter((t) => t.id !== draggingId);
        return (
          <section
            key={col.key}
            className={`kanban-col ${isOver ? "drop-target" : ""}`}
            data-kanban-col={col.key}
          >
            <header className="kanban-col-head">
              <h3 className="kanban-col-title">
                {groupBy === "status" && col.status ? (
                  <span className={`pill ${col.status}`}>{col.title}</span>
                ) : (
                  <span className="headline" style={{ fontSize: 13 }}>
                    {col.title}
                  </span>
                )}
              </h3>
              <span className="kanban-count">{col.tasks.length}</span>
            </header>
            <div className="kanban-col-body">
              {showCards.length === 0 ? (
                <div className={`kanban-empty ${isOver ? "active" : ""}`}>
                  {isOver ? "放手放到这里" : "拖到此处"}
                </div>
              ) : (
                showCards.map((task) => (
                  <article
                    key={task.id}
                    className={`kanban-card s-${task.status}`}
                    data-task-id={task.id}
                    onPointerDown={(e) => beginDrag(e, task, col.key)}
                  >
                    <div className="kanban-card-main">
                      <div className="kanban-card-title">{task.title}</div>
                      <div className="task-meta">
                        {groupBy === "workspace" && (
                          <span className={`pill ${task.status}`}>
                            {STATUS_LABEL[task.status]}
                          </span>
                        )}
                        {groupBy === "status" && task.repoPath && (
                          <span className="path-mono" title={task.repoPath}>
                            {repos.find((r) => r.path === task.repoPath)?.name ??
                              displayName(task.repoPath)}
                          </span>
                        )}
                        <span>{SOURCE_LABEL[task.source]}</span>
                      </div>
                    </div>
                    <div className="kanban-card-actions">
                      {onOpenTask && (
                        <button
                          className="kanban-action"
                          type="button"
                          title="编辑"
                          aria-label="编辑"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenTask(task);
                          }}
                        >
                          <IconEdit size={13} />
                        </button>
                      )}
                      {onStartAgent && (
                        <button
                          className="kanban-action"
                          type="button"
                          title="派发 Agent"
                          aria-label="派发 Agent"
                          disabled={busyId === task.id}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onStartAgent(task);
                          }}
                        >
                          <IconPlay size={13} />
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
              {isOver && showCards.length > 0 && (
                <div className="kanban-drop-hint">放手放到这里</div>
              )}
            </div>
          </section>
        );
      })}

      {ghost &&
        createPortal(
          <div
            ref={ghostElRef}
            className="kanban-drag-ghost"
            style={{ width: ghost.width }}
          >
            <div className="kanban-card-title">{ghost.title}</div>
            {ghost.meta && <div className="task-meta">{ghost.meta}</div>}
          </div>,
          document.body,
        )}
    </div>
  );
}
