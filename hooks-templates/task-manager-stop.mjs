#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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
      `[${new Date().toISOString()}] [STOP] ${msg}\n`,
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

function clip(text, n) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function extractTextFromMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function cleanUserText(text) {
  return String(text || "")
    .replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/g, "")
    .replace(/<\/?user_query>/g, "")
    .replace(/```browser_element[\s\S]*?```/g, "[界面元素]")
    .trim();
}

function findTranscriptPath(sessionId, hint) {
  if (hint && fs.existsSync(hint)) return hint;
  if (!sessionId) return null;
  const projectsRoot = path.join(CURSOR_DIR, "projects");
  try {
    for (const project of fs.readdirSync(projectsRoot)) {
      const candidate = path.join(
        projectsRoot,
        project,
        "agent-transcripts",
        sessionId,
        `${sessionId}.jsonl`,
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function turnsFromTranscript(transcriptPath, limit = 24) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const turns = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.role !== "user" && row.role !== "assistant") continue;
    let text = extractTextFromMessage(row.message);
    if (!text) continue;
    if (row.role === "user") text = cleanUserText(text);
    if (row.role === "assistant" && text.length < 8) continue;
    turns.push({ role: row.role, text: clip(text, 900) });
  }
  return turns.slice(-limit);
}

function turnsFromSession(session, latestText) {
  const turns = [];
  const prompts = session?.prompts || [];
  const responses = session?.responses || [];
  const n = Math.max(prompts.length, responses.length);
  for (let i = 0; i < n; i++) {
    if (prompts[i]) turns.push({ role: "user", text: clip(cleanUserText(prompts[i]), 900) });
    if (responses[i]) turns.push({ role: "assistant", text: clip(responses[i], 900) });
  }
  if (latestText) {
    const t = clip(latestText, 900);
    if (t && !turns.some((x) => x.role === "assistant" && x.text === t)) {
      turns.push({ role: "assistant", text: t });
    }
  }
  return turns.slice(-24);
}

function heuristicSummary(turns, workspace) {
  const users = turns.filter((t) => t.role === "user").map((t) => t.text);
  const asst = turns.filter((t) => t.role === "assistant").map((t) => t.text);
  const lastAsst = asst[asst.length - 1] || "";
  const title =
    clip(lastAsst, 36) ||
    (users.length > 1
      ? `完成 ${users.length} 轮 Cursor 协作`
      : clip(users[0], 36) || "Cursor 会话");
  const notes = [
    "## 做了什么",
    ...(asst.slice(-5).map((a) => `- ${clip(a, 180)}`) || ["- （暂无助手回复）"]),
    "",
    "## 用户诉求",
    ...users.slice(-8).map((u, i) => `${i + 1}. ${clip(u, 140)}`),
    workspace ? `\n工作区：${workspace}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { title: title || "Cursor 会话", notes };
}

async function aiSummarize(cfg, turns, workspace) {
  const sidecar =
    cfg.sidecarBaseUrl ||
    process.env.TASK_MANAGER_SIDECAR ||
    "http://127.0.0.1:3927";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${sidecar.replace(/\/$/, "")}/task/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turns: turns.map((t) => ({
          role: t.role,
          text: t.text.slice(0, 1200),
        })),
        workspace: workspace || null,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`sidecar ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data?.title) throw new Error("empty summary");
    return {
      title: clip(data.title, 80),
      notes: String(data.notes || "").trim().slice(0, 4000),
    };
  } finally {
    clearTimeout(timer);
  }
}

function findTaskLocal(sessionId, day) {
  const db = readLocalDb();
  if (sessionId) {
    const bySession = db.tasks.find((t) => t.cursorSessionId === sessionId);
    if (bySession) return bySession;
  }
  return (
    db.tasks.find(
      (t) => t.source === "cursor" && t.status === "doing" && t.day === day,
    ) || null
  );
}

function patchTaskLocal(taskId, patch) {
  const db = readLocalDb();
  const now = new Date().toISOString();
  db.tasks = db.tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch, updatedAt: now } : t,
  );
  writeLocalDb(db);
}

async function findTaskRemote(apiBase, token, sessionId, day) {
  if (sessionId) {
    const q = new URLSearchParams({ cursorSessionId: sessionId });
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks?${q}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const existing = await res.json();
    if (existing.tasks?.[0]) return existing.tasks[0];
  }
  const q = new URLSearchParams({ day });
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks?${q}`, {
    headers: { Authorization: "Bearer " + token },
  });
  const existing = await res.json();
  return (
    existing.tasks?.find((t) => t.source === "cursor" && t.status === "doing") ||
    null
  );
}

async function main() {
  let input = {};
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    input = JSON.parse(raw);
    log(`received stop input: ${raw.slice(0, 300)}`);
  } catch (e) {
    log(`JSON parse error: ${e.message}`);
  }

  const cfg = readCfg();
  const storageMode =
    cfg.storageMode ||
    (cfg.apiBaseUrl && cfg.apiToken ? "remote" : "local");
  const apiBase = cfg.apiBaseUrl || process.env.TASK_MANAGER_API_BASE;
  const token = cfg.apiToken || process.env.TASK_MANAGER_TOKEN;

  const sessionId = input.conversation_id || input.session_id || null;
  const event = input.hook_event_name || null;
  const status = input.status || null;
  const latestText = typeof input.text === "string" ? input.text.trim() : "";
  const day = new Date().toISOString().slice(0, 10);
  const cwd = input.workspace_roots?.[0] || null;

  const isResponseOnly =
    event === "afterAgentResponse" || (!status && !!latestText);
  if (isResponseOnly) {
    if (sessionId && latestText) {
      const session = loadSession(sessionId);
      session.workspace = cwd || session.workspace;
      session.responses.push(latestText.slice(0, 2000));
      if (session.responses.length > 40) {
        session.responses = session.responses.slice(-40);
      }
      saveSession(session);
      log(`accumulated assistant response (${latestText.length} chars)`);
    }
    process.stdout.write(JSON.stringify({}));
    return;
  }

  if (status === "aborted") {
    log("status=aborted, skip done/summarize");
    process.stdout.write(JSON.stringify({}));
    return;
  }

  try {
    let task = null;
    const useRemote = storageMode === "remote" && apiBase && token;
    if (useRemote) {
      try {
        task = await findTaskRemote(apiBase, token, sessionId, day);
      } catch (e) {
        log(`remote find failed, try local: ${e.message}`);
        task = findTaskLocal(sessionId, day);
      }
    } else {
      task = findTaskLocal(sessionId, day);
    }

    if (!task) {
      log("no matching task found");
      process.stdout.write(JSON.stringify({}));
      return;
    }

    const session = loadSession(sessionId);
    const transcriptPath = findTranscriptPath(sessionId, input.transcript_path);
    let turns = turnsFromTranscript(transcriptPath);
    if (turns.length < 2) {
      turns = turnsFromSession(session, latestText);
    }
    if (!turns.length && latestText) {
      turns = [{ role: "assistant", text: clip(latestText, 900) }];
    }

    let summary = heuristicSummary(turns, cwd || session?.workspace);
    if (turns.length) {
      try {
        summary = await aiSummarize(cfg, turns, cwd || session?.workspace);
        log(`ai summary title: ${summary.title}`);
      } catch (e) {
        log(`ai summarize failed, fallback heuristic: ${e.message}`);
      }
    }

    const patch = {
      status: "done",
      title: summary.title || task.title || PROVISIONAL_TITLE,
      notes: summary.notes || task.notes || null,
      day,
    };

    log(`patching task ${task.id} -> ${patch.title}`);
    if (useRemote && task) {
      try {
        await fetch(`${apiBase.replace(/\/$/, "")}/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(patch),
        });
      } catch (e) {
        log(`remote patch failed, local: ${e.message}`);
        patchTaskLocal(task.id, patch);
      }
    } else {
      patchTaskLocal(task.id, patch);
    }
  } catch (e) {
    log(`stop error: ${e.message}`);
  }
  process.stdout.write(JSON.stringify({}));
}

main();
