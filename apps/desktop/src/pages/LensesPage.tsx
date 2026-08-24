import { useEffect, useMemo, useState } from "react";
import type { Lens } from "@task-manager/shared";
import { IconLens } from "../components/Icons";
import {
  parsePrinciplePack,
  serializePrinciples,
  STARTER_PRINCIPLES,
} from "../lib/principlePack";
import { getCachedDb, initLocalStore, subscribeSync } from "../lib/sync";
import { useToast } from "../lib/toast";
import {
  confirmLens,
  deleteLens,
  importPrinciples,
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
  const toast = useToast();
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

  async function onImportStarter() {
    const result = await importPrinciples(STARTER_PRINCIPLES);
    refresh();
    toast.show({
      message:
        result.added > 0
          ? `已导入 ${result.added} 条常用原则` +
            (result.skipped ? `，跳过 ${result.skipped} 条同名` : "")
          : "这些原则已经在了，没有新增",
      kind: "ok",
    });
  }

  async function onImportFile() {
    const raw = await pickJsonFile();
    if (raw == null) return;
    try {
      const seeds = parsePrinciplePack(raw);
      const result = await importPrinciples(seeds);
      refresh();
      toast.show({
        message: `从文件导入 ${result.added} 条` +
          (result.skipped ? `，跳过 ${result.skipped} 条同名` : ""),
        kind: "ok",
      });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "导入失败",
        kind: "err",
      });
    }
  }

  function onExport() {
    const text = serializePrinciples(lenses);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "principles.json";
    a.click();
    URL.revokeObjectURL(a.href);
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
        <div className="muted">你的原则 · {lenses.length}</div>
        <div className="rail-list">
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
        </div>
        <div className="rail-actions">
          <button className="btn sm" type="button" onClick={startCreate}>
            新建
          </button>
          <button className="btn sm" type="button" onClick={() => void onImportStarter()}>
            导入常用
          </button>
          <button className="btn sm ghost" type="button" onClick={() => void onImportFile()}>
            从文件
          </button>
          {lenses.length > 0 && (
            <button className="btn sm ghost" type="button" onClick={onExport}>
              导出
            </button>
          )}
        </div>
      </aside>

      <div className="workbench-stage">
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
            <div className="headline" style={{ fontSize: 15 }}>还没有原则</div>
            <p className="subhead" style={{ margin: 0 }}>
              可以先导入一组常用判断框架，再改成自己的话。黄金这类具体原则请自己写。
            </p>
            <div className="row wrap" style={{ marginTop: 12 }}>
              <button className="btn primary" type="button" onClick={() => void onImportStarter()}>
                导入常用原则
              </button>
              <button className="btn" type="button" onClick={startCreate}>
                自己写一条
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lens-kicker">
              {selected.draft && <span className="chip warn">草稿 · 确认后才用来提问</span>}
              {selected.domain && <span className="chip">{selected.domain}</span>}
            </div>
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
                  确认这条原则
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

      {selected ? (
      <aside className="card inspector">
        <div className="muted">挂在这条原则上</div>
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
      ) : null}
      </div>
    </div>
  );
}

function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
