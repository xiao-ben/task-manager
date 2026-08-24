import { useEffect, useMemo, useState } from "react";
import type { Lens } from "@task-manager/shared";
import { IconLens } from "../components/Icons";
import { getCachedDb, initLocalStore, subscribeSync } from "../lib/sync";
import {
  confirmLens,
  deleteLens,
  upsertLens,
} from "../lib/workbench";

const emptyForm = {
  title: "",
  domain: "",
  what: "",
  when: "",
  whenNot: "",
  questions: "",
};

export function LensesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [tick, setTick] = useState(0);

  function refresh() {
    setTick((n) => n + 1);
  }

  useEffect(() => {
    void initLocalStore().then(refresh);
    return subscribeSync(refresh);
  }, []);

  const db = getCachedDb();
  const lenses = useMemo(() => {
    void tick;
    return [...(db?.lenses ?? [])].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1,
    );
  }, [db, tick]);

  const selected = lenses.find((l) => l.id === selectedId) ?? (
    editing || selectedId === "" ? null : lenses[0] ?? null
  );
  const linkedNotes = (db?.libraryEntries ?? []).filter((e) =>
    selected ? e.lensIds.includes(selected.id) : false,
  );
  const linkedTasks = (db?.tasks ?? []).filter((task) =>
    (db?.taskLenses ?? []).some(
      (l) => selected && l.lensId === selected.id && l.taskId === task.id,
    ),
  );

  function startCreate() {
    setSelectedId("");
    setForm(emptyForm);
    setEditing(true);
  }

  function startEdit(lens: Lens) {
    setSelectedId(lens.id);
    setForm({
      title: lens.title,
      domain: lens.domain,
      what: lens.what,
      when: lens.when,
      whenNot: lens.whenNot,
      questions: lens.questions.join("\n"),
    });
    setEditing(true);
  }

  async function save() {
    if (!form.title.trim()) return;
    const saved = await upsertLens({
      ...(selected ? { id: selected.id } : {}),
      title: form.title.trim(),
      domain: form.domain.trim(),
      what: form.what,
      when: form.when,
      whenNot: form.whenNot,
      questions: form.questions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      draft: selected?.draft ?? false,
    });
    setSelectedId(saved.id);
    setEditing(false);
    refresh();
  }

  return (
    <div className="workbench workbench-cols">
      <aside className="card workbench-rail">
        <div className="muted">你的透镜 · {lenses.length}</div>
        {lenses.map((lens) => (
          <button
            key={lens.id}
            type="button"
            className={`list-item ${selected?.id === lens.id && !editing ? "on" : ""}`}
            onClick={() => {
              setSelectedId(lens.id);
              setEditing(false);
            }}
          >
            {lens.title}
            {lens.draft ? " · 草稿" : ""}
          </button>
        ))}
        <button className="btn sm" type="button" style={{ marginTop: 10 }} onClick={startCreate}>
          新建透镜
        </button>
      </aside>

      <article className="lens-article">
        {editing ? (
          <form
            className="lens-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className="input"
              placeholder="名称，例如：黄金"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <input
              className="input"
              placeholder="适用领域（可选）"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
            />
            <label>
              是什么
              <textarea className="textarea" value={form.what} onChange={(e) => setForm({ ...form, what: e.target.value })} />
            </label>
            <label>
              适用
              <textarea className="textarea" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
            </label>
            <label>
              不适用
              <textarea className="textarea" value={form.whenNot} onChange={(e) => setForm({ ...form, whenNot: e.target.value })} />
            </label>
            <label>
              问自己（一行一个）
              <textarea className="textarea" value={form.questions} onChange={(e) => setForm({ ...form, questions: e.target.value })} />
            </label>
            <div className="row">
              <button className="btn primary" type="submit">保存</button>
              <button className="btn ghost" type="button" onClick={() => setEditing(false)}>取消</button>
            </div>
          </form>
        ) : !selected ? (
          <div className="empty">
            <div className="empty-icon"><IconLens size={22} /></div>
            <div className="headline" style={{ fontSize: 15 }}>还没有透镜</div>
            <p className="subhead" style={{ margin: 0 }}>
              写下你反复在用的问法。不要抄书，用自己的话。
            </p>
          </div>
        ) : (
          <>
            {selected.draft && <span className="chip warn">草稿 · 确认后才用来提问</span>}
            {selected.domain && <span className="chip">{selected.domain}</span>}
            <h1 className="display-serif">{selected.title}</h1>
            <h3>是什么</h3>
            <p>{selected.what || "（还没写）"}</p>
            <h3>适用</h3>
            <p>{selected.when || "（还没写）"}</p>
            <h3>不适用</h3>
            <p>{selected.whenNot || "（还没写）"}</p>
            <h3>问自己</h3>
            {selected.questions.length === 0 ? (
              <p>（还没写）</p>
            ) : (
              <ol className="lens-questions">
                {selected.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            )}
            <p className="note">
              用过 {selected.usedCount} 次
              {selected.lastUsedAt
                ? ` · 上次 ${new Date(selected.lastUsedAt).toLocaleDateString("zh-CN")}`
                : ""}
            </p>
            <div className="row wrap">
              {selected.draft && (
                <button className="btn sm primary" type="button" onClick={() => void confirmLens(selected.id).then(refresh)}>
                  确认这条透镜
                </button>
              )}
              <button className="btn sm" type="button" onClick={() => startEdit(selected)}>编辑</button>
              <button className="btn sm ghost" type="button" onClick={() => void deleteLens(selected.id).then(refresh)}>
                删除
              </button>
            </div>
          </>
        )}
      </article>

      <aside className="card inspector">
        <div className="muted">挂在这副透镜上</div>
        {linkedNotes.length === 0 && linkedTasks.length === 0 && (
          <p className="note">还没有任务或笔记挂在这里</p>
        )}
        {linkedTasks.map((task) => (
          <div className="list-item" key={task.id}>任务 · {task.title}</div>
        ))}
        {linkedNotes.map((note) => (
          <div className="list-item" key={note.id}>{note.title}</div>
        ))}
      </aside>
    </div>
  );
}
