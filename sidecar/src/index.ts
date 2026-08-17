import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

// 加载 sidecar/.env（CURSOR_API_KEY 等），文件不存在时静默跳过
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* 无 .env 文件 */
}

const execFileAsync = promisify(execFile);

const StartSchema = z.object({
  taskId: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  cursorApiKey: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  apiToken: z.string().optional(),
  model: z.string().optional(),
});

const SummarySchema = z.object({
  periodType: z.enum(["day", "week", "month"]),
  periodKey: z.string().min(1).max(32),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        status: z.string(),
        day: z.string(),
        notes: z.string().nullable().optional(),
        repoPath: z.string().nullable().optional(),
        source: z.string().optional(),
      }),
    )
    .max(500),
  cursorApiKey: z.string().optional(),
  model: z.string().optional(),
});

const TaskSummarizeSchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
  workspace: z.string().nullable().optional(),
  cursorApiKey: z.string().optional(),
  model: z.string().optional(),
});

const SUMMARY_STATUS_LABEL: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "完成",
  cancelled: "取消",
};

function buildSummaryPrompt(input: z.infer<typeof SummarySchema>): string {
  const label =
    input.periodType === "day"
      ? `日总结（${input.periodKey}）`
      : input.periodType === "week"
        ? `周总结（${input.periodKey}）`
        : `月总结（${input.periodKey}）`;
  const lines = input.tasks.map((t) => {
    const status = SUMMARY_STATUS_LABEL[t.status] ?? t.status;
    const notes = t.notes?.trim() ? `；备注：${t.notes.trim().replace(/\n/g, " ")}` : "";
    const repo = t.repoPath ? `；仓库：${t.repoPath}` : "";
    return `- [${status}] ${t.day} ${t.title}${notes}${repo}`;
  });
  return [
    `请根据以下任务清单，写一份简洁的中文${label}。`,
    "要求：",
    "1. 用 Markdown，包含「概览」「完成亮点」「未完成与风险」「下一步」四个小节",
    "2. 只基于给定事实，不要编造未出现的工作",
    "3. 语气专业克制，总长 400 字以内",
    "4. 只输出总结正文，不要前后客套话",
    "",
    input.tasks.length ? "任务清单：" : "（本周期没有任务，如实说明即可）",
    ...lines,
  ].join("\n");
}

async function generateSummary(input: z.infer<typeof SummarySchema>) {
  const apiKey = input.cursorApiKey || process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY missing — set in Settings or sidecar/.env");
  }
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey,
    model: { id: input.model ?? "composer-2.5" },
    local: { cwd: os.tmpdir() },
    tools: [],
    name: `任务台总结 ${input.periodKey}`,
  });
  try {
    const run = await agent.send(buildSummaryPrompt(input));
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(
        typeof result.error === "string" ? result.error : "AI 生成失败",
      );
    }
    const text = typeof result.result === "string" ? result.result.trim() : "";
    if (!text) {
      throw new Error("AI 返回为空");
    }
    return { draft: text };
  } finally {
    try {
      await agent[Symbol.asyncDispose]?.();
    } catch {
      /* ignore */
    }
  }
}

function buildTaskSummarizePrompt(input: z.infer<typeof TaskSummarizeSchema>) {
  const lines = input.turns.map((t, i) => {
    const role = t.role === "user" ? "用户" : "助手";
    return `${i + 1}. [${role}] ${t.text.replace(/\s+/g, " ").trim()}`;
  });
  return [
    "你是任务台的会话归档助手。根据 Cursor 对话摘录，生成「做了什么」的任务记录。",
    "要求：",
    "1. title：一句话概括实际完成的工作（动词开头，≤36 字），不要直接复述用户原话/疑问句",
    "2. notes：3-6 条 Markdown 要点，写清改动、结论与结果；不要编造摘录中没有的内容",
    "3. 只输出 JSON 对象，不要代码块，不要其它文字：{\"title\":\"...\",\"notes\":\"...\"}",
    input.workspace ? `工作区：${input.workspace}` : "",
    "",
    "对话摘录：",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseTaskSummaryJson(text: string): { title: string; notes: string } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/\{[\s\S]*\}/);
  const raw = fenced ? fenced[0] : trimmed;
  const parsed = JSON.parse(raw) as { title?: unknown; notes?: unknown };
  const title = String(parsed.title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const notes = String(parsed.notes ?? "").trim().slice(0, 4000);
  if (!title) throw new Error("AI 总结缺少 title");
  return { title, notes: notes || title };
}

async function generateTaskSummary(input: z.infer<typeof TaskSummarizeSchema>) {
  const apiKey = input.cursorApiKey || process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY missing — set in Settings or sidecar/.env");
  }
  const { Agent } = await import("@cursor/sdk");
  const agent = await Agent.create({
    apiKey,
    model: { id: input.model ?? "composer-2.5" },
    local: { cwd: os.tmpdir() },
    tools: [],
    name: "任务台会话归档",
  });
  try {
    const run = await agent.send(buildTaskSummarizePrompt(input));
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(
        typeof result.error === "string" ? result.error : "AI 生成失败",
      );
    }
    const text = typeof result.result === "string" ? result.result.trim() : "";
    if (!text) throw new Error("AI 返回为空");
    return parseTaskSummaryJson(text);
  } finally {
    try {
      await agent[Symbol.asyncDispose]?.();
    } catch {
      /* ignore */
    }
  }
}

const PORT = Number(process.env.SIDECAR_PORT ?? 3927);

function localDbPath(): string {
  return path.join(os.homedir(), ".cursor", "task-manager", "data.json");
}

type LocalDbShape = {
  tasks: Array<Record<string, unknown>>;
  repos: unknown[];
  summaries: unknown[];
  agentRuns: Array<Record<string, unknown>>;
  deletedTaskIds: string[];
  revision: number;
};

function readLocalDbFile(): LocalDbShape {
  const p = localDbPath();
  const empty: LocalDbShape = {
    tasks: [],
    repos: [],
    summaries: [],
    agentRuns: [],
    deletedTaskIds: [],
    revision: 1,
  };
  try {
    if (!fs.existsSync(p)) return empty;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<LocalDbShape>;
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      repos: Array.isArray(raw.repos) ? raw.repos : [],
      summaries: Array.isArray(raw.summaries) ? raw.summaries : [],
      agentRuns: Array.isArray(raw.agentRuns) ? raw.agentRuns : [],
      deletedTaskIds: Array.isArray(raw.deletedTaskIds) ? raw.deletedTaskIds : [],
      revision: typeof raw.revision === "number" ? raw.revision : 1,
    };
  } catch {
    return empty;
  }
}

function writeLocalDbFile(db: LocalDbShape) {
  const p = localDbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const next = { ...db, revision: (db.revision || 0) + 1 };
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, p);
}

function patchLocalTask(taskId: string, body: Record<string, unknown>) {
  try {
    const db = readLocalDbFile();
    const now = new Date().toISOString();
    let found = false;
    db.tasks = db.tasks.map((t) => {
      if (t.id !== taskId) return t;
      found = true;
      return { ...t, ...body, id: taskId, updatedAt: now };
    });
    if (found) writeLocalDbFile(db);
  } catch (err) {
    console.error("failed to patch local task", err);
  }
}

function upsertLocalAgentRun(run: Record<string, unknown>) {
  try {
    const db = readLocalDbFile();
    const id = String(run.id ?? "");
    if (!id) return;
    const idx = db.agentRuns.findIndex((r) => r.id === id);
    if (idx >= 0) db.agentRuns[idx] = { ...db.agentRuns[idx], ...run };
    else db.agentRuns.push(run);
    db.agentRuns = db.agentRuns.slice(-500);
    writeLocalDbFile(db);
  } catch (err) {
    console.error("failed to upsert local agent run", err);
  }
}

async function patchTask(
  apiBaseUrl: string | undefined,
  apiToken: string | undefined,
  taskId: string,
  body: Record<string, unknown>,
) {
  // Always update local-first store so UI refreshes without cloud sync
  patchLocalTask(taskId, body);
  if (!apiBaseUrl || !apiToken) return;
  try {
    await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("failed to patch task", err);
  }
}

async function agentRunApi(
  apiBaseUrl: string | undefined,
  apiToken: string | undefined,
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
): Promise<{ id?: string } | null> {
  if (!apiBaseUrl || !apiToken) return null;
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/agent-runs${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { run?: { id?: string } };
    return data.run ?? null;
  } catch (err) {
    console.error("agent-runs api failed", err);
    return null;
  }
}

const RESULT_LIMIT = 20_000;
const TRANSCRIPT_LIMIT = 200_000;

async function startAgent(input: z.infer<typeof StartSchema>) {
  const apiKey = input.cursorApiKey || process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY missing — set in Settings or env");
  }

  // Dynamic import so the process can still boot if package resolution differs
  const { Agent } = await import("@cursor/sdk");

  let cwd = input.cwd;
  if (cwd.endsWith(".code-workspace")) {
    cwd = agentCwdFromWorkspaceFile(cwd);
  }

  const agent = await Agent.create({
    apiKey,
    model: { id: input.model ?? "composer-2.5" },
    local: { cwd },
  });

  const run = await agent.send(input.prompt);

  const record = await agentRunApi(
    input.apiBaseUrl,
    input.apiToken,
    "POST",
    "",
    { taskId: input.taskId, agentId: agent.agentId, runId: run.id },
  );

  const localRunId = record?.id ?? randomUUID();
  const createdAt = new Date().toISOString();
  upsertLocalAgentRun({
    id: localRunId,
    taskId: input.taskId,
    agentId: agent.agentId ?? null,
    runId: run.id ?? null,
    status: "running",
    result: null,
    transcript: null,
    error: null,
    createdAt,
    finishedAt: null,
  });

  // Don't block the HTTP response on full completion; return ids immediately
  void (async () => {
    try {
      const result = await run.wait();
      const status = result.status === "error" ? "error" : "done";
      let transcript: string | null = null;
      try {
        const turns = await run.conversation();
        transcript = JSON.stringify(turns).slice(0, TRANSCRIPT_LIMIT);
      } catch {
        /* 部分运行不支持回放 transcript */
      }
      const resultText =
        typeof result.result === "string" ? result.result.slice(0, RESULT_LIMIT) : null;
      if (record?.id) {
        await agentRunApi(input.apiBaseUrl, input.apiToken, "PATCH", `/${record.id}`, {
          status,
          result: resultText,
          transcript,
        });
      }
      upsertLocalAgentRun({
        id: localRunId,
        taskId: input.taskId,
        agentId: agent.agentId ?? null,
        runId: run.id ?? null,
        status,
        result: resultText,
        transcript,
        error: null,
        createdAt,
        finishedAt: new Date().toISOString(),
      });
      await patchTask(input.apiBaseUrl, input.apiToken, input.taskId, {
        status: status === "error" ? "todo" : "done",
        cursorAgentId: agent.agentId ?? undefined,
      });
    } catch (err) {
      console.error("agent run failed", err);
      const message = err instanceof Error ? err.message : "unknown";
      if (record?.id) {
        await agentRunApi(input.apiBaseUrl, input.apiToken, "PATCH", `/${record.id}`, {
          status: "error",
          error: message,
        });
      }
      upsertLocalAgentRun({
        id: localRunId,
        taskId: input.taskId,
        agentId: agent.agentId ?? null,
        runId: run.id ?? null,
        status: "error",
        result: null,
        transcript: null,
        error: message,
        createdAt,
        finishedAt: new Date().toISOString(),
      });
      await patchTask(input.apiBaseUrl, input.apiToken, input.taskId, {
        status: "todo",
      });
    } finally {
      try {
        await agent[Symbol.asyncDispose]?.();
      } catch {
        /* ignore */
      }
    }
  })();

  const agentId = agent.agentId;

  await patchTask(input.apiBaseUrl, input.apiToken, input.taskId, {
    status: "doing",
    cursorAgentId: agentId,
    repoPath: input.cwd,
  });

  return { agentId, runId: run.id };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

type RecentWorkspace = {
  /** 登记路径：文件夹绝对路径，或 .code-workspace 文件绝对路径 */
  path: string;
  /** Agent 用的目录 cwd */
  cwd: string;
  name: string;
  kind: "folder" | "workspace";
  exists: boolean;
};

function agentCwdFromWorkspaceFile(workspaceFile: string): string {
  try {
    const raw = fs.readFileSync(workspaceFile, "utf8");
    const data = JSON.parse(raw) as { folders?: Array<{ path?: string }> };
    const first = data.folders?.[0]?.path;
    if (first) {
      return path.isAbsolute(first)
        ? first
        : path.resolve(path.dirname(workspaceFile), first);
    }
  } catch {
    /* ignore */
  }
  return path.dirname(workspaceFile);
}

/** 从 Cursor 的 state.vscdb 读取最近打开的目录/工作区（VSCode 内核共用此存储） */
async function listCursorWorkspaces(): Promise<RecentWorkspace[]> {
  const db = path.join(
    os.homedir(),
    "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
  );
  if (!fs.existsSync(db)) return [];

  const { stdout } = await execFileAsync("sqlite3", [
    db,
    "SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList'",
  ]);
  const parsed = JSON.parse(stdout.trim() || "{}") as {
    entries?: Array<{
      folderUri?: string;
      fileUri?: string;
      workspace?: { configPath?: string };
      label?: string;
    }>;
  };

  const seen = new Set<string>();
  const out: RecentWorkspace[] = [];
  for (const entry of parsed.entries ?? []) {
    const uri = entry.folderUri ?? entry.workspace?.configPath;
    if (!uri || !uri.startsWith("file://")) continue;
    const p = decodeURIComponent(uri.slice("file://".length));
    if (seen.has(p)) continue;
    seen.add(p);

    const isWorkspace = p.endsWith(".code-workspace");
    let exists = false;
    let cwd = p;
    let name = path.basename(p);

    if (isWorkspace) {
      try {
        exists = fs.statSync(p).isFile();
      } catch {
        exists = false;
      }
      cwd = exists ? agentCwdFromWorkspaceFile(p) : path.dirname(p);
      name =
        entry.label?.replace(/\s*\(工作区\)\s*$/, "").replace(/^~\/Documents\/work\//, "") ||
        path.basename(p, ".code-workspace");
      // label 经常是 "~/Documents/work/小程序Agent (工作区)"，优先取文件名更干净
      name = path.basename(p, ".code-workspace");
    } else {
      try {
        exists = fs.statSync(p).isDirectory();
      } catch {
        exists = false;
      }
      name = path.basename(p);
    }

    out.push({
      path: p,
      cwd,
      name,
      kind: isWorkspace ? "workspace" : "folder",
      exists,
    });
  }
  return out;
}

const server = http.createServer(async (req, res) => {  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/cursor/workspaces") {
    try {
      const workspaces = await listCursorWorkspaces();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ workspaces }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/summary/generate") {
    try {
      const raw = await readBody(req);
      const parsed = SummarySchema.safeParse(JSON.parse(raw || "{}"));
      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.flatten() }));
        return;
      }
      const result = await generateSummary(parsed.data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("summary generate failed:", message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/task/summarize") {
    try {
      const raw = await readBody(req);
      const parsed = TaskSummarizeSchema.safeParse(JSON.parse(raw || "{}"));
      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.flatten() }));
        return;
      }
      const result = await generateTaskSummary(parsed.data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("task summarize failed:", message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/agent/start") {
    try {
      const raw = await readBody(req);
      const parsed = StartSchema.safeParse(JSON.parse(raw || "{}"));
      if (!parsed.success) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: parsed.error.flatten() }));
        return;
      }
      const result = await startAgent(parsed.data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sidecar] listening on http://127.0.0.1:${PORT}`);
});
