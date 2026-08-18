/** cursor=经典 Cursor Chat 预填；local=sidecar 静默执行；machine=Remote Control */
export type AgentDispatchMode = "cursor" | "machine" | "local";

export type AppSettings = {
  apiBaseUrl: string;
  apiToken: string;
  cursorApiKey: string;
  sidecarUrl: string;
  /** When true, bidirectional sync with configured API. Default: local-only. */
  syncEnabled: boolean;
  /** 默认派发方式 */
  agentDispatchMode: AgentDispatchMode;
  /** My Machines worker 名称（agent worker start --name） */
  myMachineName: string;
  widgetPosition?: { x: number; y: number };
};

const KEY = "task-manager.settings";

const defaults: AppSettings = {
  apiBaseUrl: "",
  apiToken: import.meta.env.VITE_TASK_MANAGER_TOKEN ?? "",
  cursorApiKey: "",
  sidecarUrl: "http://127.0.0.1:3927",
  syncEnabled: false,
  agentDispatchMode: "cursor",
  myMachineName: "task-manager",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const parsed = { ...defaults, ...JSON.parse(raw) } as AppSettings;
    if (typeof parsed.syncEnabled !== "boolean") {
      parsed.syncEnabled = false;
    }
    if (
      parsed.agentDispatchMode !== "cursor" &&
      parsed.agentDispatchMode !== "local" &&
      parsed.agentDispatchMode !== "machine"
    ) {
      parsed.agentDispatchMode = "cursor";
    }
    if (typeof parsed.myMachineName !== "string" || !parsed.myMachineName.trim()) {
      parsed.myMachineName = defaults.myMachineName;
    }
    return parsed;
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function dispatchPlayLabel(
  mode: AgentDispatchMode = loadSettings().agentDispatchMode,
): string {
  if (mode === "local") return "静默执行";
  if (mode === "machine") return "Remote Control 派发";
  return "经典 Cursor Chat 预填";
}
