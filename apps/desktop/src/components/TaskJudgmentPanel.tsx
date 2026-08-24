import { useMemo, useState } from "react";
import type { Lens, Task } from "@task-manager/shared";
import { getCachedDb } from "../lib/sync";
import {
  lensesForTask,
  linkTaskLens,
  recordJudgment,
  suggestLensesForTask,
  unlinkTaskLens,
} from "../lib/workbench";

type Props = {
  task: Task | null;
  onDispatch?: (task: Task) => void;
  onChanged?: () => void;
};

export function TaskJudgmentPanel({ task, onDispatch, onChanged }: Props) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const db = getCachedDb();
  const allLenses = db?.lenses ?? [];

  const attached = useMemo(
    () => (task ? lensesForTask(db, task.id) : []),
    [db, task],
  );
  const suggested = useMemo(() => {
    if (!task) return [];
    const have = new Set(attached.map((l) => l.id));
    return suggestLensesForTask(task, allLenses).filter((l) => !have.has(l.id));
  }, [task, attached, allLenses]);

  const active: Lens[] = attached.length > 0 ? attached : suggested;

  if (!task) {
    return (
      <aside className="card inspector sticky-inspect">
        <p className="note">点一条任务，用原则看看。不替你做决定。</p>
      </aside>
    );
  }

  return (
    <aside className="card inspector sticky-inspect">
      {active.some((l) => !l.draft) && <span className="chip warn">待判断</span>}
      <h2>{task.title}</h2>
      {task.notes?.trim() && <p className="note">{task.notes}</p>}

      <div className="row wrap" style={{ marginTop: 8 }}>
        {attached.map((lens) => (
          <button
            key={lens.id}
            type="button"
            className="chip"
            title="取消挂接"
            onClick={() => void unlinkTaskLens(task.id, lens.id).then(() => onChanged?.())}
          >
            {lens.title} ×
          </button>
        ))}
        {suggested.map((lens) => (
          <button
            key={lens.id}
            type="button"
            className="chip indigo"
            onClick={() => void linkTaskLens(task.id, lens.id).then(() => onChanged?.())}
          >
            + {lens.title}
          </button>
        ))}
      </div>

      {allLenses.filter((l) => !l.draft && !attached.some((a) => a.id === l.id)).length > 0 && (
        <select
          className="select"
          style={{ marginTop: 8 }}
          value=""
          aria-label="挂上原则"
          onChange={(e) => {
            const id = e.target.value;
            if (id) void linkTaskLens(task.id, id).then(() => onChanged?.());
          }}
        >
          <option value="">挂上一条原则…</option>
          {allLenses
            .filter((l) => !attached.some((a) => a.id === l.id))
            .map((lens) => (
              <option key={lens.id} value={lens.id}>
                {lens.draft ? `${lens.title}（草稿）` : lens.title}
              </option>
            ))}
        </select>
      )}

      {active.filter((l) => !l.draft).length > 0 ? (
        <div className="ask">
          <b>用这些原则问你</b>
          {active
            .filter((l) => !l.draft)
            .flatMap((lens) =>
              (lens.questions.length > 0 ? lens.questions : [`用「${lens.title}」看这件事，适用吗？`]).map(
                (q) => `${lens.title}：${q}`,
              ),
            )
            .map((q) => (
              <div key={q}>{q}</div>
            ))}
        </div>
      ) : (
        <p className="note">还没有可用的原则。先在「原则」里导入或写一条，草稿确认后才会提问。</p>
      )}

      <textarea
        className="textarea"
        rows={4}
        placeholder="记下判断…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="判断"
      />
      {msg && <div className="callout info">{msg}</div>}
      <div className="row wrap">
        <button
          className="btn primary"
          type="button"
          disabled={!note.trim()}
          onClick={() =>
            void recordJudgment({
              task,
              lensIds: active.filter((l) => !l.draft).map((l) => l.id),
              content: note.trim(),
            }).then(() => {
              setNote("");
              setMsg("已写入库");
              onChanged?.();
            })
          }
        >
          记下判断
        </button>
        {onDispatch && (
          <button className="btn" type="button" onClick={() => onDispatch(task)}>
            派给 Cursor
          </button>
        )}
      </div>
    </aside>
  );
}
