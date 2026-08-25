---
name: task-manager-capture
description: >-
  Deposits a finished discussion into the local 任务台 workbench (Inbox, 库, 原则, 对话).
  Use when the user asks to 沉淀, 录入任务台, 写进工作台, capture conclusions/todos from this chat,
  or send discussed questions into the personal task manager.
---

# 沉淀到任务台

把当前对话里已经谈清楚的东西写入本机任务台，不要再让用户复制粘贴。

数据只写本机 `~/.cursor/task-manager/data.json`。不要改成云同步，也不要派发 Agent。

## 何时用

- 用户说「沉淀」「录入任务台」「写进工作台」「记到 Inbox」
- 讨论结束，有结论、待办、灵感或一条可复用的判断原则
- 其他 Agent 需要把本轮产出交回任务台

## 写入规则

从对话里抽出结构化字段，**只写讨论里出现过的内容**，不要编造：

| 字段 | 进哪里 | 说明 |
|------|--------|------|
| `title` | 对话标题 | 一句话，≤80 字 |
| `body` | 对话原文 | 摘要即可，不必整段逐字稿 |
| `conclusions` | **库** · 摘录 | 已经想清楚的结论 |
| `todos` | **Inbox** | 还没承诺今天做的待办 |
| `inspiration` | **Inbox** | 灵感、未决问题 |
| `principle` | **原则** · 草稿 | 可复用的判断框架；具体仓位规则请用户自己写 |

`source` 用 `claude` / `cursor` / `chatgpt` / `other`。`agent` 填自己的名字，例如 `claude-code`。

## 怎么写

优先 HTTP（任务台或 sidecar 在跑时，界面会马上刷新）：

```bash
curl -sS -X POST http://127.0.0.1:3927/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "要不要加黄金仓位",
    "source": "claude",
    "agent": "claude-code",
    "body": "讨论摘要",
    "conclusions": ["黄金当保险，不追高"],
    "todos": ["看当前仓位占比"],
    "inspiration": ["只在下跌后加"],
    "principle": {
      "title": "黄金仓位",
      "what": "把黄金当保险，而不是进攻仓",
      "questions": ["这是在买保险，还是在追涨？"]
    }
  }'
```

sidecar 没开时，用本 skill 的脚本（会改同一份 `data.json`）：

```bash
node scripts/ingest.mjs <<'JSON'
{
  "title": "要不要加黄金仓位",
  "source": "other",
  "todos": ["看当前仓位占比"]
}
JSON
```

成功时 stdout 是 JSON：`ok`、`conversationId`、`inboxIds`、`libraryId`、`lensId`。用一两句话告诉用户进了 Inbox / 库 / 原则的哪几条。

## 注意

- 本机接口只绑 `127.0.0.1`，不要打到公网
- 同名原则会跳过，不覆盖用户已有条目
- 原则默认是草稿，用户确认后才会用来提问
- 没有可沉淀的内容就不要调用
