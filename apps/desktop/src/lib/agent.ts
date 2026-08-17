import { loadSettings } from "./settings";

export async function startAgent(input: {
  taskId: string;
  prompt: string;
  cwd: string;
}): Promise<{ agentId: string; runId?: string }> {
  const { sidecarUrl, cursorApiKey, apiBaseUrl, apiToken } = loadSettings();
  const res = await fetch(`${sidecarUrl.replace(/\/$/, "")}/agent/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      cursorApiKey,
      apiBaseUrl,
      apiToken,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to start agent");
  }
  return body;
}

export type CursorWorkspace = {
  /** 文件夹或 .code-workspace 文件路径 */
  path: string;
  /** Agent 用的目录 cwd */
  cwd: string;
  name: string;
  kind: "folder" | "workspace";
  exists: boolean;
};

export async function listCursorWorkspaces(): Promise<CursorWorkspace[]> {
  const { sidecarUrl } = loadSettings();
  const res = await fetch(`${sidecarUrl.replace(/\/$/, "")}/cursor/workspaces`);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to read Cursor workspaces");
  }
  return (body as { workspaces: CursorWorkspace[] }).workspaces;
}

export type SummaryTaskInput = {
  title: string;
  status: string;
  day: string;
  notes?: string | null;
  repoPath?: string | null;
  source?: string;
};

/** 用本地 sidecar 里的 Cursor Agent 生成总结（复用 CURSOR_API_KEY） */
export async function generateSummaryWithCursor(input: {
  periodType: "day" | "week" | "month";
  periodKey: string;
  tasks: SummaryTaskInput[];
}): Promise<{ draft: string }> {
  const { sidecarUrl, cursorApiKey } = loadSettings();
  let res: Response;
  try {
    res = await fetch(`${sidecarUrl.replace(/\/$/, "")}/summary/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, cursorApiKey: cursorApiKey || undefined }),
    });
  } catch {
    // One retry after asking the native shell to start sidecar
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ensure_sidecar_cmd");
      res = await fetch(`${sidecarUrl.replace(/\/$/, "")}/summary/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, cursorApiKey: cursorApiKey || undefined }),
      });
    } catch {
      throw new Error("sidecar 未运行（请打开设置页点「启动 Sidecar」，或确认已安装 Node.js）");
    }
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "AI 总结生成失败",
    );
  }
  return body as { draft: string };
}
