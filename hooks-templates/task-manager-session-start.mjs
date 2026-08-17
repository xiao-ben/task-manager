#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const HOME = process.env.HOME || os.homedir() || "";
const CURSOR_DIR = path.join(HOME, ".cursor");
const SESSIONS_DIR = path.join(CURSOR_DIR, "task-manager-sessions");
const LOCAL_DB = path.join(CURSOR_DIR, "task-manager", "data.json");
const PROVISIONAL_TITLE = "Cursor 会话进行中";

function log(msg) {
  try {
    fs.appendFileSync(
      path.join(CURSOR_DIR, "task-manager-hook.log"),
      `[${new Date().toISOString()}] [START] ${msg}\n`,
    );
  } catch {}
}

function readCfg() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(CURSOR_DIR, "task-manager.env.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

function emptyDb() {
  return {
    tasks: [],
    repos: [],
    summaries: [],
    agentRuns: [],
    deletedTaskIds: [],
    revision: 1,
  };
}

function readLocalDb() {
  try {
    if (!fs.existsSync(LOCAL_DB)) return emptyDb();
    const raw = JSON.parse(fs.readFileSync(LOCAL_DB, "utf8"));
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      repos: Array.isArray(raw.repos) ? raw.repos : [],
      summaries: Array.isArray(raw.summaries) ? raw.summaries : [],
      agentRuns: Array.isArray(raw.agentRuns) ? raw.agentRuns : [],
      deletedTaskIds: Array.isArray(raw.deletedTaskIds) ? raw.deletedTaskIds : [],
      revision: typeof raw.revision === "number" ? raw.revision : 1,
    };
  } catch {
    return emptyDb();
  }
}

function writeLocalDb(db) {
  const dir = path.dirname(LOCAL_DB);
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...db, revision: (db.revision || 0) + 1 };
  const tmp = LOCAL_DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, LOCAL_DB);
}

function loadSession(sessionId) {
  if (!sessionId) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), "utf8"),
    );
  } catch {
    return {
      sessionId,
      workspace: null,
      prompts: [],
      responses: [],
      updatedAt: null,
    };
  }
}

function saveSession(session) {
  if (!session?.sessionId) return;
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(SESSIONS_DIR, `${session.sessionId}.json`),
    JSON.stringify(session, null, 2),
  );
}

function extractPrompt(input) {
  const raw =
    input.prompt ||
    input.text ||
    input.query ||
    input.conversation_title ||
    "";
  return String(raw).trim().slice(0, 2000);
}

/** 用首条诉求做可读标题，避免长期停在「Cursor 会话进行中」 */
function titleFromPrompt(prompt) {
  const line = String(prompt || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

function upsertLocalDoing({ sessionId, day, cwd, prompt }) {
  const db = readLocalDb();
  const now = new Date().toISOString();
  let task = sessionId
    ? db.tasks.find((t) => t.cursorSessionId === sessionId)
    : null;
  if (task) {
    const nextTitle =
      task.title === PROVISIONAL_TITLE && prompt
        ? titleFromPrompt(prompt) || task.title
        : task.title;
    task = {
      ...task,
      title: nextTitle,
      status: "doing",
      day,
      updatedAt: now,
      repoPath: cwd || task.repoPath,
    };
    db.tasks = db.tasks.map((t) => (t.id === task.id ? task : t));
    writeLocalDb(db);
    log(`local update task ${task.id} -> doing`);
    return;
  }
  // sessionStart 常无 prompt：此时不建占位任务，等 beforeSubmitPrompt 再写
  if (!prompt) {
    log("skip create: no prompt yet (wait for beforeSubmitPrompt)");
    return;
  }
  const title = titleFromPrompt(prompt) || PROVISIONAL_TITLE;
  task = {
    id: crypto.randomUUID(),
    title,
    notes: `进行中…\n\n最近诉求：${prompt.slice(0, 200)}`,
    status: "doing",
    day,
    repoPath: cwd || null,
    cursorAgentId: null,
    cursorSessionId: sessionId,
    source: "cursor",
    createdAt: now,
    updatedAt: now,
  };
  db.tasks.push(task);
  writeLocalDb(db);
  log(`local create task ${task.id} title=${title}`);
}

async function upsertRemoteDoing({ apiBase, token, sessionId, day, cwd, prompt }) {
  if (sessionId) {
    const q = new URLSearchParams({ cursorSessionId: sessionId });
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks?${q}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const existing = await res.json();
    if (existing.tasks?.length) {
      const task = existing.tasks[0];
      const patch = { status: "doing", day };
      if (task.title === PROVISIONAL_TITLE && prompt) {
        patch.title = titleFromPrompt(prompt) || task.title;
      }
      log(`updating existing task ${task.id} to doing`);
      await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(patch),
      });
      return;
    }
  }

  if (!prompt) {
    log("skip remote create: no prompt yet");
    return;
  }
  const title = titleFromPrompt(prompt) || PROVISIONAL_TITLE;
  log(`creating task: ${title}`);
  await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      title,
      notes: `进行中…\n\n最近诉求：${prompt.slice(0, 200)}`,
      day,
      repoPath: cwd,
      cursorSessionId: sessionId,
      source: "cursor",
      status: "doing",
    }),
  });
}

async function main() {
  let input = {};
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    input = JSON.parse(raw);
    log(`received input: ${raw.slice(0, 300)}`);
  } catch (e) {
    log(`JSON parse error: ${e.message}`);
  }

  const cfg = readCfg();
  const storageMode =
    cfg.storageMode ||
    (cfg.apiBaseUrl && cfg.apiToken ? "remote" : "local");
  const apiBase = cfg.apiBaseUrl || process.env.TASK_MANAGER_API_BASE;
  const token = cfg.apiToken || process.env.TASK_MANAGER_TOKEN;

  const prompt = extractPrompt(input);
  const cwd = input.workspace_roots?.[0] || input.cwd || null;
  const sessionId = input.conversation_id || input.session_id || null;
  const day = new Date().toISOString().slice(0, 10);

  if (sessionId && prompt) {
    const session = loadSession(sessionId);
    session.workspace = cwd || session.workspace;
    if (!session.prompts.includes(prompt)) {
      session.prompts.push(prompt);
      if (session.prompts.length > 40) session.prompts = session.prompts.slice(-40);
    }
    saveSession(session);
  }

  try {
    if (storageMode === "local") {
      upsertLocalDoing({ sessionId, day, cwd, prompt });
    } else {
      if (!apiBase || !token) {
        log("remote mode missing apiBaseUrl or token; falling back to local");
        upsertLocalDoing({ sessionId, day, cwd, prompt });
      } else {
        await upsertRemoteDoing({ apiBase, token, sessionId, day, cwd, prompt });
      }
    }
  } catch (e) {
    log(`write error: ${e.message}`);
    try {
      upsertLocalDoing({ sessionId, day, cwd, prompt });
    } catch (e2) {
      log(`local fallback failed: ${e2.message}`);
    }
  }
  process.stdout.write(JSON.stringify({}));
}

main();
