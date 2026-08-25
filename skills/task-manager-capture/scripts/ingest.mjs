#!/usr/bin/env node
/**
 * Deposit a discussion into 任务台.
 * Prefers POST http://127.0.0.1:3927/ingest (live refresh).
 * Falls back to writing ~/.cursor/task-manager/data.json.
 *
 * Usage:
 *   node ingest.mjs payload.json
 *   node ingest.mjs --stdin < payload.json
 *   echo '{"title":"...","todos":["..."]}' | node ingest.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SIDECAR = (process.env.TASK_MANAGER_SIDECAR || "http://127.0.0.1:3927").replace(
  /\/$/,
  "",
);
const LOCAL_DB =
  process.env.TASK_MANAGER_DATA?.trim() ||
  path.join(os.homedir(), ".cursor", "task-manager", "data.json");

function toLines(value, max = 40, each = 4000) {
  if (value == null || value === "") return [];
  const arr = Array.isArray(value) ? value : String(value).split(/\n+/);
  const out = [];
  for (const raw of arr) {
    const line = String(raw)
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!line) continue;
    out.push(line.slice(0, each));
    if (out.length >= max) break;
  }
  return out;
}

function normalize(raw) {
  const conclusions = toLines(raw.conclusions);
  const todos = toLines(raw.todos);
  const inspiration = toLines(raw.inspiration);
  const principle = raw.principle && raw.principle.title
    ? {
        title: String(raw.principle.title).trim().slice(0, 80),
        what: String(raw.principle.what || "").slice(0, 2000),
        when: String(raw.principle.when || "").slice(0, 2000),
        whenNot: String(raw.principle.whenNot || "").slice(0, 2000),
        questions: toLines(raw.principle.questions, 8, 300),
      }
    : null;
  const title = String(
    raw.title || todos[0] || conclusions[0] || principle?.title || "Agent 沉淀",
  )
    .trim()
    .slice(0, 200);
  const source = ["cursor", "claude", "chatgpt", "other"].includes(raw.source)
    ? raw.source
    : "other";
  const body = String(raw.body || "").slice(0, 100000);
  const agent = String(raw.agent || "").slice(0, 80);
  if (!body.trim() && !conclusions.length && !todos.length && !inspiration.length && !principle) {
    throw new Error("至少提供 body / conclusions / todos / inspiration / principle 之一");
  }
  return { title, source, agent, body, conclusions, todos, inspiration, principle };
}

async function postSidecar(deposit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${SIDECAR}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deposit),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`sidecar ${res.status}: ${text.slice(0, 240)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function applyLocal(deposit) {
  const empty = {
    tasks: [],
    repos: [],
    summaries: [],
    agentRuns: [],
    deletedTaskIds: [],
    inboxItems: [],
    libraryEntries: [],
    lenses: [],
    conversations: [],
    taskLenses: [],
    revision: 1,
  };
  let db = { ...empty };
  try {
    if (fs.existsSync(LOCAL_DB)) {
      const raw = JSON.parse(fs.readFileSync(LOCAL_DB, "utf8"));
      db = { ...empty, ...raw };
      for (const key of Object.keys(empty)) {
        if (key !== "revision" && !Array.isArray(db[key])) db[key] = [];
      }
    }
  } catch {
    db = { ...empty };
  }
  const now = new Date().toISOString();
  const header = [deposit.agent ? `Agent：${deposit.agent}` : "", `来源：${deposit.source}`]
    .filter(Boolean)
    .join("\n");
  const conversation = {
    id: randomUUID(),
    title: deposit.title,
    source: deposit.source,
    body: [header, deposit.body.trim()].filter(Boolean).join("\n\n").slice(0, 100000),
    taskId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.conversations = [conversation, ...db.conversations];
  const result = {
    ok: true,
    conversationId: conversation.id,
    libraryId: null,
    lensId: null,
    inboxIds: [],
    counts: { inbox: 0, conclusions: 0, principles: 0 },
    via: "file",
  };
  if (deposit.conclusions.length) {
    const entry = {
      id: randomUUID(),
      title: `摘录 · ${deposit.title}`.slice(0, 200),
      content: deposit.conclusions.map((l) => `- ${l}`).join("\n").slice(0, 20000),
      kind: "excerpt",
      lensIds: [],
      taskIds: [],
      conversationIds: [conversation.id],
      createdAt: now,
      updatedAt: now,
    };
    db.libraryEntries = [entry, ...db.libraryEntries];
    result.libraryId = entry.id;
    result.counts.conclusions = deposit.conclusions.length;
  }
  for (const line of [...deposit.todos, ...deposit.inspiration]) {
    const item = {
      id: randomUUID(),
      body: line.slice(0, 4000),
      source: "agent",
      conversationId: conversation.id,
      createdAt: now,
    };
    db.inboxItems = [item, ...db.inboxItems];
    result.inboxIds.push(item.id);
  }
  result.counts.inbox = result.inboxIds.length;
  if (deposit.principle?.title) {
    const want = deposit.principle.title.trim().toLowerCase();
    const exists = db.lenses.some(
      (lens) => String(lens.title || "").trim().toLowerCase() === want,
    );
    if (!exists) {
      const lens = {
        id: randomUUID(),
        title: deposit.principle.title,
        domain: "",
        what: deposit.principle.what || deposit.conclusions.join("\n"),
        when: deposit.principle.when,
        whenNot: deposit.principle.whenNot,
        questions: deposit.principle.questions,
        draft: true,
        usedCount: 0,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      db.lenses = [lens, ...db.lenses];
      result.lensId = lens.id;
      result.counts.principles = 1;
    }
  }
  fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true });
  const next = { ...db, revision: (db.revision || 0) + 1 };
  const tmp = `${LOCAL_DB}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, LOCAL_DB);
  return result;
}

async function readPayload() {
  const args = process.argv.slice(2).filter((a) => a !== "--stdin");
  const file = args[0];
  if (file && file !== "-") {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim() || "{}";
  return JSON.parse(raw);
}

async function main() {
  const deposit = normalize(await readPayload());
  try {
    const result = await postSidecar(deposit);
    process.stdout.write(JSON.stringify({ ...result, via: "sidecar" }) + "\n");
    return;
  } catch (err) {
    const result = applyLocal(deposit);
    result.sidecarError = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
  process.exit(1);
});
