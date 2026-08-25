import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry, LibraryKind } from "@task-manager/shared";
import { IconBook } from "../components/Icons";
import { getCachedDb, initLocalStore, subscribeSync } from "../lib/sync";
import {
  deleteLibraryEntry,
  upsertLibraryEntry,
} from "../lib/workbench";

const KIND_LABEL: Record<LibraryKind | "summary", string> = {
  note: "笔记",
  judgment: "判断",
  excerpt: "摘录",
  summary: "周期",
};

type Filter = "all" | LibraryKind | "summary";

type Row =
  | { key: string; kind: LibraryKind; entry: LibraryEntry; at: string }
  | {
      key: string;
      kind: "summary";
      title: string;
      content: string;
      at: string;
    };

export function LibraryPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tick, setTick] = useState(0);

  function refresh() {
    setTick((n) => n + 1);
  }

  useEffect(() => {
    void initLocalStore().then(refresh);
    return subscribeSync(refresh);
  }, []);

  const db = getCachedDb();
  const rows = useMemo(() => {
    void tick;
    const list: Row[] = [];
    for (const entry of db?.libraryEntries ?? []) {
      list.push({ key: entry.id, kind: entry.kind, entry, at: entry.updatedAt });
    }
    for (const summary of db?.summaries ?? []) {
      if (!summary.content.trim()) continue;
      list.push({
        key: `summary:${summary.periodType}:${summary.periodKey}`,
        kind: "summary",
        title: `${summary.periodType === "day" ? "日" : summary.periodType === "week" ? "周" : "月"}总结 · ${summary.periodKey}`,
        content: summary.content,
        at: summary.updatedAt,
      });
    }
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    return list;
  }, [db, tick]);

  const visible = rows.filter((row) => {
    if (filter !== "all" && row.kind !== filter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const title = row.kind === "summary" ? row.title : row.entry.title;
    const body = row.kind === "summary" ? row.content : row.entry.content;
    return `${title}\n${body}`.toLowerCase().includes(q);
  });

  const current = visible.find((row) => row.key === selected) ?? visible[0] ?? null;

  async function saveNote() {
    if (!title.trim()) return;
    await upsertLibraryEntry({ title: title.trim(), content, kind: "note" });
    setTitle("");
    setContent("");
    refresh();
  }

  return (
    <div className="workbench workbench-cols">
      <aside className="card workbench-rail">
        <div className="muted">类型</div>
        <div className="rail-list">
        {(
          [
            ["all", "全部"],
            ["note", "笔记"],
            ["summary", "周期总结"],
            ["judgment", "判断记录"],
            ["excerpt", "对话摘录"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`list-item ${filter === key ? "on" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        </div>
      </aside>

      <div className="workbench-stage">
      <div className="workbench-main">
        <div className="hero" style={{ marginBottom: 14 }}>
          <div>
            <div className="hero-eyebrow">沉淀</div>
            <h1 className="hero-date display-serif">库</h1>
            <div className="subhead">消化过的东西才进这里</div>
          </div>
        </div>
        <input
          className="input"
          placeholder="搜索库…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索库"
        />
        <form
          className="library-new"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <input
            className="input"
            placeholder="新笔记标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="btn primary" type="submit">
            写入
          </button>
        </form>
        {title && (
          <textarea
            className="textarea"
            rows={3}
            placeholder="正文（可选）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <IconBook size={22} />
            </div>
            <div className="headline" style={{ fontSize: 15 }}>库还是空的</div>
            <p className="subhead" style={{ margin: 0 }}>
              从 Inbox 入库，或把日总结保存后会出现在这里
            </p>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 12 }}>
            {visible.map((row) => {
              const heading = row.kind === "summary" ? row.title : row.entry.title;
              return (
                <button
                  type="button"
                  className={`library-row ${current?.key === row.key ? "sel" : ""}`}
                  key={row.key}
                  onClick={() => setSelected(row.key)}
                >
                  <div className="t-title">{heading}</div>
                  <div className="task-meta">
                    <span className="chip">{KIND_LABEL[row.kind]}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {current ? (
      <aside className="card inspector">
        {current.kind === "summary" ? (
          <>
            <span className="chip">周期</span>
            <h2>{current.title}</h2>
            <pre className="inspect-body">{current.content}</pre>
          </>
        ) : (
          <>
            <span className="chip">{KIND_LABEL[current.kind]}</span>
            <h2>{current.entry.title}</h2>
            <pre className="inspect-body">{current.entry.content || "（无正文）"}</pre>
            <button
              className="btn sm ghost"
              type="button"
              onClick={() =>
                void deleteLibraryEntry(current.entry.id).then(() => {
                  setSelected(null);
                  refresh();
                })
              }
            >
              删除
            </button>
          </>
        )}
      </aside>
      ) : null}
      </div>
    </div>
  );
}
