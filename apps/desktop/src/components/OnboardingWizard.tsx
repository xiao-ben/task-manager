import { useEffect, useState } from "react";
import {
  buildHooksJson,
  getEnvConfigJson,
  getHookScripts,
} from "../lib/hooks-install";
import { loadSettings, saveSettings } from "../lib/settings";
import { displayName, pickDirectory } from "../lib/picker";
import { listReposLocal, upsertRepoLocal } from "../lib/sync";

const DONE_KEY = "task-manager.onboarding.done";

export function markOnboardingDone() {
  localStorage.setItem(DONE_KEY, "1");
}

/** Sync heuristic — may still open briefly until async check finishes. */
export function shouldShowOnboarding(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY) === "1") return false;
    if (loadSettings().cursorApiKey?.trim()) {
      markOnboardingDone();
      return false;
    }
    try {
      const raw = localStorage.getItem("task-manager.local.db");
      if (raw) {
        const db = JSON.parse(raw) as { tasks?: unknown[]; repos?: unknown[] };
        if ((db.tasks?.length ?? 0) > 0 || (db.repos?.length ?? 0) > 0) {
          markOnboardingDone();
          return false;
        }
      }
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

/** Prefer this on app boot: also detects sidecar/.env and local data.json. */
export async function shouldShowOnboardingAsync(): Promise<boolean> {
  if (!shouldShowOnboarding()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const configured = (await invoke("cursor_api_key_configured")) as boolean;
    if (configured) {
      markOnboardingDone();
      return false;
    }
  } catch {
    /* browser */
  }
  try {
    const repos = await listReposLocal();
    if (repos.length > 0) {
      markOnboardingDone();
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function OnboardingWizard({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState(() => loadSettings().cursorApiKey);
  const [sidecarOk, setSidecarOk] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [envKeyReady, setEnvKeyReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const configured = (await invoke("cursor_api_key_configured")) as boolean;
        if (configured || loadSettings().cursorApiKey?.trim()) {
          setEnvKeyReady(true);
          setStep(1);
          setMsg("已检测到 API Key（设置或 sidecar/.env），可跳过填写");
        }
      } catch {
        /* browser */
      }
    })();
  }, [open]);

  if (!open) return null;

  async function saveKey() {
    const next = saveSettings({ ...loadSettings(), cursorApiKey: apiKey.trim() });
    setApiKey(next.cursorApiKey);
    setMsg("已保存 API Key");
    setStep(1);
  }

  async function checkSidecar() {
    setBusy(true);
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ensure_sidecar_cmd");
      const status = (await invoke("sidecar_status")) as { healthy: boolean };
      setSidecarOk(status.healthy);
      setMsg(status.healthy ? "Sidecar 已运行" : "Sidecar 未就绪");
      if (status.healthy) setStep(2);
    } catch {
      try {
        const base = (loadSettings().sidecarUrl || "http://127.0.0.1:3927").replace(
          /\/$/,
          "",
        );
        const res = await fetch(`${base}/health`);
        setSidecarOk(res.ok);
        setMsg(res.ok ? "Sidecar 已运行" : "请确认已安装 Node.js ≥ 22");
        if (res.ok) setStep(2);
      } catch {
        setSidecarOk(false);
        setMsg("Sidecar 未运行：原生 App 会自动启动；需本机 Node.js ≥ 22");
      }
    } finally {
      setBusy(false);
    }
  }

  async function installHooks() {
    setBusy(true);
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_cursor_hooks", {
        hooksJson: buildHooksJson(),
        envJson: getEnvConfigJson(),
        scripts: getHookScripts(),
      });
      setMsg("已安装 Cursor Hooks");
      setStep(3);
    } catch {
      setMsg("当前环境无法自动写入 Hooks，可到设置页稍后安装");
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  async function addRepo() {
    setBusy(true);
    setMsg(null);
    try {
      const path = await pickDirectory();
      if (!path) {
        setMsg("已跳过选择仓库");
        finish();
        return;
      }
      await upsertRepoLocal({ name: displayName(path), path });
      setMsg(`已添加仓库：${displayName(path)}`);
      finish();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    markOnboardingDone();
    onClose();
  }

  const titles = [
    "填写 Cursor API Key（可选）",
    "确认 Sidecar（可选）",
    "安装 Hooks（可选）",
    "关联一个仓库（可选）",
  ];

  return (
    <div className="onboard-overlay" role="dialog" aria-modal="true" aria-label="快速开始">
      <div className="onboard-panel rise">
        <div className="onboard-head">
          <span className="seal" aria-hidden>
            今
          </span>
          <div style={{ flex: 1 }}>
            <div className="hero-eyebrow">快速开始 · 均可跳过 · {step + 1}/4</div>
            <h2 className="headline" style={{ margin: 0 }}>
              {titles[step]}
            </h2>
          </div>
          <button className="btn plain sm" type="button" onClick={finish}>
            关闭
          </button>
        </div>

        <p className="subhead" style={{ margin: 0 }}>
          这些不是强制门槛。你已在 sidecar/.env 配过 Key 时，不必再填；Sidecar
          也会随 App 自动启动。
        </p>

        {msg && (
          <div className={`callout ${sidecarOk === false ? "err" : "info"}`} role="status">
            {msg}
          </div>
        )}

        {step === 0 && (
          <div className="form-section">
            <p className="subhead" style={{ margin: 0 }}>
              也可只放在 <code>sidecar/.env</code> 的 CURSOR_API_KEY；设置页再存一份仅方便 UI
              调用时带上。
            </p>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="CURSOR_API_KEY（可留空）"
              autoComplete="off"
            />
            <div className="row">
              <button
                className="btn primary"
                type="button"
                disabled={!apiKey.trim()}
                onClick={() => void saveKey()}
              >
                保存并继续
              </button>
              <button className="btn plain" type="button" onClick={() => setStep(1)}>
                跳过
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="form-section">
            <p className="subhead" style={{ margin: 0 }}>
              {envKeyReady
                ? "Key 已就绪。可检测一下 Sidecar，或直接跳过。"
                : "原生 App 启动时会自动拉起 Sidecar（需 Node.js ≥ 22）。"}
            </p>
            <div className="row">
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={() => void checkSidecar()}
              >
                {busy ? "检测中…" : "启动并检测"}
              </button>
              <button className="btn plain" type="button" onClick={() => setStep(2)}>
                跳过
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="form-section">
            <p className="subhead" style={{ margin: 0 }}>
              安装后，Cursor 会话开始/结束会自动写入待办。已装过可跳过。
            </p>
            <div className="row">
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={() => void installHooks()}
              >
                {busy ? "安装中…" : "安装 Hooks"}
              </button>
              <button className="btn plain" type="button" onClick={() => setStep(3)}>
                跳过
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="form-section">
            <p className="subhead" style={{ margin: 0 }}>
              选一个常用代码目录，派发 Agent 时默认用它。已有仓库可直接完成。
            </p>
            <div className="row">
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={() => void addRepo()}
              >
                选择目录…
              </button>
              <button className="btn plain" type="button" onClick={finish}>
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
