import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Task } from "@task-manager/shared";
import { TaskEditor } from "./TaskEditor";

type Props = {
  task: Task;
  onDone: (next: Task | null) => void;
  onCancel: () => void;
};

export function TaskEditModal({ task, onDone, onCancel }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="task-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="编辑任务"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="task-modal-panel rise">
        <div className="task-modal-head">
          <h2 className="headline" style={{ fontSize: 15, margin: 0 }}>
            编辑任务
          </h2>
        </div>
        <div className="task-modal-body">
          <TaskEditor task={task} onDone={onDone} onCancel={onCancel} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
