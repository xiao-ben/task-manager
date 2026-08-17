import { loadSettings } from "./settings";
import sessionStartScript from "../../../../hooks-templates/task-manager-session-start.mjs?raw";
import stopScript from "../../../../hooks-templates/task-manager-stop.mjs?raw";

export function buildHooksJson(nodeBin = "node"): string {
  const startCmd = `${nodeBin} ~/.cursor/hooks/task-manager-session-start.mjs`;
  const stopCmd = `${nodeBin} ~/.cursor/hooks/task-manager-stop.mjs`;
  return JSON.stringify(
    {
      version: 1,
      hooks: {
        sessionStart: [{ command: startCmd }],
        beforeSubmitPrompt: [{ command: startCmd }],
        afterAgentResponse: [{ command: stopCmd }],
        stop: [{ command: stopCmd }],
        sessionEnd: [{ command: stopCmd }],
      },
    },
    null,
    2,
  );
}

export function getHookScripts() {
  return {
    "task-manager-session-start.mjs": sessionStartScript,
    "task-manager-stop.mjs": stopScript,
  };
}

export function getEnvConfigJson() {
  const s = loadSettings();
  const storageMode =
    s.syncEnabled && s.apiBaseUrl?.trim() ? "remote" : "local";
  return JSON.stringify(
    {
      storageMode,
      apiBaseUrl: s.apiBaseUrl,
      apiToken: s.apiToken,
      sidecarBaseUrl: s.sidecarUrl || "http://127.0.0.1:3927",
      localDbPath: "~/.cursor/task-manager/data.json",
    },
    null,
    2,
  );
}

/** Browser fallback: download files for manual install */
export function downloadHooksBundle() {
  const scripts = getHookScripts();
  const files: Record<string, string> = {
    "hooks.json.snippet": buildHooksJson(),
    "task-manager.env.json": getEnvConfigJson(),
    ...scripts,
  };
  for (const [name, content] of Object.entries(files)) {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
