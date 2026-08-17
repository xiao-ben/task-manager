import type {
  AgentRun,
  CreateRepoInput,
  CreateTaskInput,
  PeriodType,
  Repo,
  Summary,
  Task,
  UpdateTaskInput,
} from "@task-manager/shared";
import { loadSettings } from "./settings";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { apiBaseUrl, apiToken } = loadSettings();
  const url = `${apiBaseUrl.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : "Network error");
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body);
  }
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; memory?: boolean }>("/api/health"),

  listTasks: (params: {
    day?: string;
    from?: string;
    to?: string;
    cursorSessionId?: string;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.day) q.set("day", params.day);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.cursorSessionId) q.set("cursorSessionId", params.cursorSessionId);
    const qs = q.toString();
    return request<{ tasks: Task[] }>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },

  createTask: (input: CreateTaskInput) =>
    request<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateTask: (id: string, input: UpdateTaskInput) =>
    request<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

  listRepos: () => request<{ repos: Repo[] }>("/api/repos"),

  upsertRepo: (input: CreateRepoInput) =>
    request<{ repo: Repo }>("/api/repos", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteRepo: (id: string) =>
    request<{ ok: boolean }>(`/api/repos/${id}`, { method: "DELETE" }),

  listAgentRuns: (taskId: string) =>
    request<{ runs: AgentRun[] }>(`/api/agent-runs?taskId=${encodeURIComponent(taskId)}`),

  getSummary: (type: PeriodType, key: string, draft = false) => {
    const q = new URLSearchParams({ type, key });
    if (draft) q.set("draft", "1");
    return request<{
      summary: Summary | null;
      draft?: string;
      tasks?: Task[];
    }>(`/api/summaries?${q}`);
  },

  generateAiSummary: (type: PeriodType, key: string) =>
    request<{ draft: string; tasks?: Task[] }>("/api/summaries/ai", {
      method: "POST",
      body: JSON.stringify({ periodType: type, periodKey: key }),
    }),

  upsertSummary: (input: {
    periodType: PeriodType;
    periodKey: string;
    content: string;
  }) =>
    request<{ summary: Summary }>("/api/summaries", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
};
