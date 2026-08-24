import { useEffect, useMemo, useState } from "react";
import type { Conversation, ConversationSource } from "@task-manager/shared";
import { IconChat } from "../components/Icons";
import { getCachedDb, initLocalStore, listAgentRunsLocal, subscribeSync } from "../lib/sync";
import { useToast } from "../lib/toast";
import {
  deleteConversation,
  extractConversation,
  importAgentRunAsConversation,
  upsertConversation,
} from "../lib/workbench";

const SOURCE_LABEL: Record<ConversationSource, string> = {
  cursor: "Cursor",
  claude: "Claude",
  chatgpt: "ChatGPT",
  other: "其他",
};

export function ConversationsPage() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<ConversationSource>("claude");
  const [body, setBody] = useState("");
  const [conclusions, setConclusions] = useState("");
  const [todos, setTodos] = useState("");
  const [inspiration, setInspiration] = useState("");
  const [lensTitle, setLensTitle] = useState("");
  const [lensWhat, setLensWhat] = useState("");
  const [lensQuestions, setLensQuestions] = useState("");
  const [tick, setTick] = useState(0);

  function refresh() {
    setTick((n) => n + 1);
  }

  useEffect(() => {
    void initLocalStore().then(refresh);
    return subscribeSync(refresh);
  }, []);

  const db = getCachedDb();
  const conversations = useMemo(() => {
    void tick;
    return [...(db?.conversations ?? [])].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1,
    );
  }, [db, tick]);

  const selected =
    conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  async function savePaste() {
    if (!title.trim() || !body.trim()) return;
    const saved = await upsertConversation({
      title: title.trim(),
      source,
      body: body.trim(),
    });
    setTitle("");
    setBody("");
    setSelectedId(saved.id);
    refresh();
  }

  async function importLatestRuns() {
    const tasks = (db?.tasks ?? []).filter((t) => t.cursorAgentId);
    let count = 0;
    for (const task of tasks.slice(0, 12)) {
      const runs = await listAgentRunsLocal(task.id);
      for (const run of runs.slice(0, 3)) {
        if (!(run.transcript || run.result)) continue;
        await importAgentRunAsConversation(run);
        count += 1;
      }
    }
    refresh();
    toast.show({
      message: count > 0 ? `已导入 ${count} 条 Cursor 运行` : "没有可导入的运行记录",
      kind: "ok",
    });
  }

  async function applyExtract(conversation: Conversation) {
    await extractConversation(conversation, {
      conclusions,
      todos,
      inspiration,
      lensTitle,
      lensWhat,
      lensQuestions,
    });
    setConclusions("");
    setTodos("");
    setInspiration("");
    setLensTitle("");
    setLensWhat("");
    setLensQuestions("");
    refresh();
    toast.show({ message: "已抽出：结论进库，待办/灵感进 Inbox", kind: "ok" });
  }

  return (
    <div className="workbench workbench-cols">
      <aside className="card workbench-rail">
        <div className="muted">来源</div>
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`list-item ${selected?.id === c.id ? "on" : ""}`}
            onClick={() => setSelectedId(c.id)}
          >
            {SOURCE_LABEL[c.source]} · {c.title}
          </button>
        ))}
        {conversations.length === 0 && <p className="note">还没有对话</p>}
        <button className="btn sm" type="button" style={{ marginTop: 10 }} onClick={() => void importLatestRuns()}>
          导入 Cursor 运行
        </button>
      </aside>

      <div>
        <div className="hero" style={{ marginBottom: 14 }}>
          <div>
            <div className="hero-eyebrow">原材料</div>
            <h1 className="hero-date display-serif">对话</h1>
            <div className="subhead">整段存档，有价值的再抽出去</div>
          </div>
        </div>

        <form
          className="card paste-form"
          onSubmit={(e) => {
            e.preventDefault();
            void savePaste();
          }}
        >
          <div className="row wrap">
            <input
              className="input"
              placeholder="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select className="select" value={source} onChange={(e) => setSource(e.target.value as ConversationSource)}>
              <option value="claude">Claude</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="cursor">Cursor</option>
              <option value="other">其他</option>
            </select>
          </div>
          <textarea
            className="textarea"
            rows={5}
            placeholder="把对话贴进来…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="btn primary" type="submit">存档</button>
        </form>

        {selected ? (
          <div className="conv-body card">
            <div className="task-meta">
              <span className="chip indigo">{SOURCE_LABEL[selected.source]}</span>
              <span>{new Date(selected.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <h2>{selected.title}</h2>
            <pre className="inspect-body">{selected.body}</pre>
            <button className="btn sm ghost" type="button" onClick={() => void deleteConversation(selected.id).then(refresh)}>
              删除
            </button>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon"><IconChat size={22} /></div>
            <div className="headline" style={{ fontSize: 15 }}>把对话收回来</div>
            <p className="subhead" style={{ margin: 0 }}>粘贴 Claude / ChatGPT，或导入 Cursor 运行记录</p>
          </div>
        )}
      </div>

      <aside className="card inspector">
        <h2>从这段抽出</h2>
        <label>
          结论
          <textarea className="textarea" rows={3} value={conclusions} onChange={(e) => setConclusions(e.target.value)} placeholder="一行一条" />
        </label>
        <label>
          待办
          <textarea className="textarea" rows={2} value={todos} onChange={(e) => setTodos(e.target.value)} placeholder="会进 Inbox" />
        </label>
        <label>
          灵感
          <textarea className="textarea" rows={2} value={inspiration} onChange={(e) => setInspiration(e.target.value)} />
        </label>
        <label>
          透镜草稿名称
          <input className="input" value={lensTitle} onChange={(e) => setLensTitle(e.target.value)} placeholder="例如：黄金" />
        </label>
        <label>
          是什么
          <textarea className="textarea" rows={2} value={lensWhat} onChange={(e) => setLensWhat(e.target.value)} />
        </label>
        <label>
          问自己
          <textarea className="textarea" rows={2} value={lensQuestions} onChange={(e) => setLensQuestions(e.target.value)} />
        </label>
        <button
          className="btn primary"
          type="button"
          disabled={!selected}
          onClick={() => selected && void applyExtract(selected)}
        >
          写入库 / Inbox
        </button>
      </aside>
    </div>
  );
}
