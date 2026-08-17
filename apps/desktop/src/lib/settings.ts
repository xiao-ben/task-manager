export type AppSettings = {
  apiBaseUrl: string;
  apiToken: string;
  cursorApiKey: string;
  sidecarUrl: string;
  /** When true, bidirectional sync with configured API. Default: local-only. */
  syncEnabled: boolean;
  widgetPosition?: { x: number; y: number };
};

const KEY = "task-manager.settings";

const defaults: AppSettings = {
  apiBaseUrl: "",
  apiToken: import.meta.env.VITE_TASK_MANAGER_TOKEN ?? "",
  cursorApiKey: "",
  sidecarUrl: "http://127.0.0.1:3927",
  syncEnabled: false,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const parsed = { ...defaults, ...JSON.parse(raw) } as AppSettings;
    if (typeof parsed.syncEnabled !== "boolean") {
      parsed.syncEnabled = false;
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
