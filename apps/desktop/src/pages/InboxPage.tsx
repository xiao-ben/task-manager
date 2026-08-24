import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InboxItem } from "@task-manager/shared";
import { IconInbox } from "../components/Icons";
import { getCachedDb, initLocalStore, subscribeSync } from "../lib/sync";
import { useToast } from "../lib/toast";
import {
  createInboxItem,
  deleteInboxItem,
  openInbox,
  restoreInboxItem,
  triageInboxToLens,
  triageInboxToLibrary,
  triageInboxToToday,
} from "../lib/workbench";

const SOURCE_LABEL: Record<InboxItem["source"], string> = {
  manual: "灵感",
  widget: "小窗",
  conversation: "对话",
  other: "其他",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

export function InboxPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [items, setItems] = useState<InboxItem[]>(() => openInbox(getCachedDb()));

  function refresh() {
    setItems(openInbox(getCachedDb()));
  }

  useEffect(() => {
    void initLocalStore().then(refresh);
    const unsub = subscribeSync(refresh);
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, []);

  async function capture() {
    if (!body.trim()) return;
    await createInboxItem({ body: body.trim(), source: "manual" });
    setBody("");
    refresh();
    inputRef.current?.focus();
  }

  async function discard(item: InboxItem) {
    await deleteInboxItem(item.id);
    refresh();
    toast.show({
      message: "已丢掉",
      kind: "ok",
      action: {
        label: "撤销",
        onClick: async () => {
          await restoreInboxItem(item);
          refresh();
        },
      },
    });
  }

  return (
    <div className="workbench">
      <div className="hero">
        <div>
          <div className="hero-eyebrow">捕捉</div>
          <h1 className="hero-date display-serif">Inbox</h1>
          <div className="subhead">先扔进来，再决定今天做不做 · {items.length} 条</div>
        </div>
      </div>

      <form
        className="composer workbench-capture"
        onSubmit={(e) => {
          e.preventDefault();
          void capture();
        }}
      >
        <input
          ref={inputRef}
          className="input"
          placeholder="一句话，先不承诺…  ⌘N"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Inbox 捕捉"
        />
        <button className="btn primary" type="submit">
          放入
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <IconInbox size={22} />
          </div>
          <div className="headline" style={{ fontSize: 15 }}>
            Inbox 是空的
          </div>
          <p className="subhead" style={{ margin: 0 }}>
            灵感、对话摘录、还没承诺的事都先放这里
          </p>
        </div>
      ) : (
        <div className="inbox-list">
          {items.map((item) => (
            <article className="card inbox-card" key={item.id}>
              <div className="task-meta">
                <span className="chip">{SOURCE_LABEL[item.source]}</span>
                <span>{formatTime(item.createdAt)}</span>
              </div>
              <p className="inbox-body">{item.body}</p>
              <div className="row wrap">
                <button
                  className="btn sm primary"
                  type="button"
                  onClick={() =>
                    void triageInboxToToday(item).then(() => {
                      refresh();
                      navigate("/");
                    })
                  }
                >
                  今日
                </button>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() =>
                    void triageInboxToLibrary(item).then(() => {
                      refresh();
                      navigate("/library");
                    })
                  }
                >
                  入库
                </button>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() =>
                    void triageInboxToLens(item).then(() => {
                      refresh();
                      navigate("/lenses");
                    })
                  }
                >
                  做透镜
                </button>
                <button
                  className="btn sm ghost"
                  type="button"
                  onClick={() => void discard(item)}
                >
                  丢掉
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
