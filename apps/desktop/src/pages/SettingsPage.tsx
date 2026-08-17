import { useEffect, useState } from "react";
import type { Repo } from "@task-manager/shared";
import { listCursorWorkspaces, type CursorWorkspace } from "../lib/agent";
import { api } from "../lib/api";
import {
  exportHistoryToFile,
  pickAndImportHistory,
} from "../lib/backup";
import {
  buildHooksJson,
  downloadHooksBundle,
  getEnvConfigJson,
  getHookScripts,
} from "../lib/hooks-install";
import { loadSettings, saveSettings, type AppSettings } from "../lib/settings";
import { displayName, pickDirectory } from "../lib/picker";
import {
  deleteRepoLocal,
  listReposLocal,
  reloadLocalStore,
  syncNow,
  upsertRepoLocal,
} from "../lib/sync";

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoName, setRepoName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("未检测");
  const [syncBusy, setSyncBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [sidecarHealth, setSidecarHealth] = useState<string>("检测中…");
  const [recent, setRecent] = useState<CursorWorkspace[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  async function refreshRepos() {
    try {
      setRepos(await listReposLocal());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshRepos();
    void refreshSidecarStatus();
  }, []);

  async function refreshSidecarStatus() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = (await invoke("sidecar_status")) as {
        healthy: boolean;
        url: string;
      };
      if (status.healthy) {
        setSidecarHealth("运行中");
        return;
      }
      const result = (await invoke("ensure_sidecar_cmd")) as string;
      setSidecarHealth(
        result === "already_running" || result === "started" || result === "starting"
          ? "运行中"
          : result,
      );
    } catch {
      // Browser / health fetch fallback
      try {
        const base = (loadSettings().sidecarUrl || "http://127.0.0.1:3927").replace(
          /\/$/,
          "",
        );
        const res = await fetch(`${base}/health`);
        setSidecarHealth(res.ok ? "运行中" : "未运行");
      } catch {
        setSidecarHealth("未运行");
      }
    }
  }

  function onSave() {
    const next = saveSettings(settings);
    setSettings(next);
    setMsg("设置已保存到本地");
    // Refresh hook env in Tauri so storageMode stays in sync
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("install_cursor_hooks", {
          hooksJson: buildHooksJson(),
          envJson: getEnvConfigJson(),
          scripts: getHookScripts(),
        });
      } catch {
        /* browser / no tauri — skip */
      }
    })();
  }

  async function ping() {
    try {
      saveSettings(settings);
      if (!settings.apiBaseUrl.trim()) {
        setHealth("未配置");
        setMsg("请先填写 API Base URL");
        return;
      }
      const h = await api.health();
      setHealth(h.memory ? "内存库 · 正常" : "Postgres · 正常");
      setMsg(null);
    } catch (err) {
      setHealth("失败");
      setMsg(err instanceof Error ? err.message : "连接失败");
    }
  }

  async function runSyncNow() {
    setSyncBusy(true);
    try {
      saveSettings(settings);
      await syncNow();
      setMsg(settings.syncEnabled ? "同步完成" : "当前为仅本地模式");
      await refreshRepos();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "同步失败");
    } finally {
      setSyncBusy(false);
    }
  }

  async function exportHistory() {
    setBackupBusy(true);
    try {
      const path = await exportHistoryToFile();
      setMsg(`已导出：${path}`);
    } catch (err) {
      if (err instanceof Error && err.message === "已取消导出") {
        setMsg(null);
      } else {
        setMsg(err instanceof Error ? err.message : "导出失败");
      }
    } finally {
      setBackupBusy(false);
    }
  }

  async function importHistory(mode: "replace" | "merge") {
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const ok = await dialog.ask(
        mode === "replace"
          ? "将用备份文件完整替换本机任务、仓库与总结，当前数据会被覆盖。确定继续？"
          : "将按更新时间合并备份与本机数据（同 id 保留较新的）。确定继续？",
        {
          title: mode === "replace" ? "替换导入" : "合并导入",
          kind: "warning",
          okLabel: "导入",
          cancelLabel: "取消",
        },
      );
      if (!ok) return;
    } catch {
      /* browser: proceed */
    }

    setBackupBusy(true);
    try {
      const result = await pickAndImportHistory(mode);
      await reloadLocalStore();
      await refreshRepos();
      setMsg(
        `导入完成（${mode === "replace" ? "替换" : "合并"}）：任务 ${result.count.tasks} · 仓库 ${result.count.repos} · 总结 ${result.count.summaries}`,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "已取消导入") {
        setMsg(null);
      } else {
        setMsg(err instanceof Error ? err.message : "导入失败");
      }
    } finally {
      setBackupBusy(false);
    }
  }

  async function pickAndAddRepo() {
    const path = await pickDirectory();
    if (!path) {
      setMsg("浏览器模式下请手动填写路径；原生 App 中可直接选择目录");
      return;
    }
    try {
      await upsertRepoLocal({ name: displayName(path), path });
      setMsg(`已添加：${displayName(path)}`);
      await refreshRepos();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "添加失败");
    }
  }

  async function loadCursorRecent() {
    try {
      setMsg(null);
      const list = await listCursorWorkspaces();
      setRecent(list);
      // 默认勾选「存在且未登记」的目录
      const existing = new Set(repos.map((r) => r.path));
      setPicked(new Set(list.filter((w) => w.exists && !existing.has(w.path)).map((w) => w.path)));
      if (list.length === 0) setMsg("未读取到 Cursor 最近打开的目录");
    } catch (err) {
      setRecent(null);
      setMsg(
        `读取失败：${err instanceof Error ? err.message : "unknown"}（sidecar 未就绪，可点「启动 Sidecar」重试）`,
      );
    }
  }

  async function importPicked() {
    if (!recent || picked.size === 0) return;
    setImporting(true);
    try {
      for (const w of recent) {
        if (picked.has(w.path)) {
          await upsertRepoLocal({ name: w.name, path: w.path });
        }
      }
      setMsg(`已导入 ${picked.size} 个目录`);
      setRecent(null);
      await refreshRepos();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function addRepo(e: React.FormEvent) {
    e.preventDefault();
    if (!repoName.trim() || !repoPath.trim()) return;
    await upsertRepoLocal({ name: repoName.trim(), path: repoPath.trim() });
    setRepoName("");
    setRepoPath("");
    await refreshRepos();
  }

  async function installHooksViaTauri() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_cursor_hooks", {
        hooksJson: buildHooksJson(),
        envJson: getEnvConfigJson(),
        scripts: getHookScripts(),
      });
      setMsg("已写入 ~/.cursor hooks");
    } catch {
      downloadHooksBundle();
      setMsg(
        "当前非 Tauri 环境：已下载 hooks 文件，请手动放到 ~/.cursor/hooks/ 并合并 hooks.json",
      );
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="large-title display-serif">设置</h1>
          <p className="subhead" style={{ margin: "4px 0 0" }}>
            本地数据、可选同步与仓库
          </p>
        </div>
      </header>

      {msg && (
        <div className="callout info" role="status">
          {msg}
        </div>
      )}

      <section className="group">
        <div className="group-header">
          <h2 className="headline">数据与同步</h2>
        </div>
        <div className="form-section">
          <p className="subhead" style={{ margin: 0 }}>
            任务默认保存在本机{" "}
            <code className="path-mono">~/.cursor/task-manager/data.json</code>
            ，不依赖网络即可读写。开启同步后，可与任意兼容服务端双向合并（以更新时间较新者为准）。
          </p>
          <label className="row" style={{ gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={settings.syncEnabled}
              onChange={(e) =>
                setSettings((s) => ({ ...s, syncEnabled: e.target.checked }))
              }
            />
            <span className="headline" style={{ fontSize: 14 }}>
              启用与服务端双向同步
            </span>
          </label>
          <div className="field">
            <label className="field-label" htmlFor="apiBase">
              API Base URL
            </label>
            <input
              id="apiBase"
              className="input"
              value={settings.apiBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, apiBaseUrl: e.target.value }))
              }
              placeholder="https://your-api.example.com"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="apiToken">
              Bearer Token
            </label>
            <input
              id="apiToken"
              className="input"
              value={settings.apiToken}
              onChange={(e) =>
                setSettings((s) => ({ ...s, apiToken: e.target.value }))
              }
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn primary" type="button" onClick={onSave}>
              保存
            </button>
            <button
              className="btn bordered"
              type="button"
              disabled={syncBusy || !settings.syncEnabled}
              onClick={() => void runSyncNow()}
            >
              {syncBusy ? "同步中…" : "立即同步"}
            </button>
            <button className="btn bordered" type="button" onClick={() => void ping()}>
              测试连接
            </button>
            <span
              className={`pill ${health.includes("正常") ? "ok" : "neutral"}`}
            >
              {health}
            </span>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <span className="field-label">历史数据备份</span>
            <p className="subhead" style={{ margin: "4px 0 8px" }}>
              导出/导入本机任务、仓库与日周月总结（JSON）。不含设置里的 API Token /
              CURSOR_API_KEY。
            </p>
            <div className="row">
              <button
                className="btn bordered"
                type="button"
                disabled={backupBusy}
                onClick={() => void exportHistory()}
              >
                {backupBusy ? "处理中…" : "导出历史数据"}
              </button>
              <button
                className="btn bordered"
                type="button"
                disabled={backupBusy}
                onClick={() => void importHistory("merge")}
              >
                合并导入…
              </button>
              <button
                className="btn bordered"
                type="button"
                disabled={backupBusy}
                onClick={() => void importHistory("replace")}
              >
                替换导入…
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="group">
        <div className="group-header">
          <h2 className="headline">Cursor Agent</h2>
        </div>
        <div className="form-section">
          <div className="field">
            <label className="field-label" htmlFor="cursorKey">
              CURSOR_API_KEY（仅存本机）
            </label>
            <input
              id="cursorKey"
              className="input"
              type="password"
              value={settings.cursorApiKey}
              onChange={(e) =>
                setSettings((s) => ({ ...s, cursorApiKey: e.target.value }))
              }
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="sidecar">
              Sidecar URL
            </label>
            <input
              id="sidecar"
              className="input"
              value={settings.sidecarUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, sidecarUrl: e.target.value }))
              }
            />
          </div>
          <div className="row">
            <button className="btn primary" type="button" onClick={onSave}>
              保存
            </button>
            <button
              className="btn bordered"
              type="button"
              onClick={() => void refreshSidecarStatus()}
            >
              启动 Sidecar
            </button>
            <span
              className={`pill ${sidecarHealth === "运行中" ? "ok" : "neutral"}`}
            >
              {sidecarHealth}
            </span>
          </div>
          <p className="subhead" style={{ margin: 0 }}>
            原生 App 启动时会自动拉起本机 sidecar（需本机 Node.js ≥ 22）；退出时若由本应用启动则会一并关闭。失败时可点「启动 Sidecar」重试。
          </p>
          <div>
            <button
              className="btn sm bordered"
              type="button"
              onClick={() => {
                localStorage.removeItem("task-manager.onboarding.done");
                setMsg("已重置引导标记，重新打开应用将显示快速开始");
              }}
            >
              重置快速开始引导
            </button>
          </div>
        </div>
      </section>

      <section className="group">
        <div className="group-header">
          <h2 className="headline">关联仓库</h2>
        </div>
        <div className="form-section">
          <form className="stack-sm" onSubmit={(e) => void addRepo(e)}>
            <div className="row">
              <input
                className="input"
                placeholder="名称"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                aria-label="仓库名称"
              />
              <input
                className="input"
                placeholder="/绝对路径/到/仓库"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                aria-label="仓库路径"
              />
              <button
                className="btn bordered"
                type="button"
                onClick={() => void pickAndAddRepo()}
              >
                选择目录…
              </button>
              <button className="btn primary" type="submit">
                添加
              </button>
              <button
                className="btn bordered"
                type="button"
                onClick={() => void loadCursorRecent()}
              >
                从 Cursor 导入…
              </button>
            </div>
          </form>
          {recent && (
            <div className="import-panel">
              <div className="import-panel-header">
                <span className="subhead">
                  Cursor 最近打开 · 共 {recent.length} 项
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn sm primary"
                    type="button"
                    disabled={picked.size === 0 || importing}
                    onClick={() => void importPicked()}
                  >
                    {importing ? "导入中…" : `导入所选（${picked.size}）`}
                  </button>
                  <button
                    className="btn sm plain"
                    type="button"
                    onClick={() => setRecent(null)}
                  >
                    收起
                  </button>
                </div>
              </div>
              <div className="import-list">
                {recent.map((w) => {
                  const registered = repos.some((r) => r.path === w.path);
                  return (
                    <label
                      key={w.path}
                      className={`import-row ${w.exists && !registered ? "" : "muted"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!w.exists || registered}
                        checked={picked.has(w.path)}
                        onChange={(e) => {
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(w.path);
                            else next.delete(w.path);
                            return next;
                          });
                        }}
                      />
                      <span className="headline" style={{ fontSize: 14 }}>
                        {w.name}
                      </span>
                      {w.kind === "workspace" && (
                        <span className="pill neutral">工作区</span>
                      )}
                      {registered && <span className="pill ok">已登记</span>}
                      {!w.exists && <span className="pill warn">路径已失效</span>}
                      <span className="path-mono">{w.path}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {repos.length === 0 ? (
            <p className="subhead">还没有关联仓库</p>
          ) : (
            repos.map((r) => (
              <div className="repo-row" key={r.id}>
                <div>
                  <div className="headline">{r.name}</div>
                  <div className="path-mono">{r.path}</div>
                </div>
                <button
                  className="btn danger-ghost"
                  type="button"
                  aria-label="删除仓库"
                  onClick={() =>
                    void deleteRepoLocal(r.id).then(() => refreshRepos())
                  }
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="group">
        <div className="group-header">
          <h2 className="headline">Cursor → 待办</h2>
        </div>
        <div className="form-section">
          <p className="subhead" style={{ margin: 0 }}>
            安装后，Cursor sessionStart / stop 会按当前模式写入：本地模式写本机库，开启同步时写配置的服务端。
          </p>
          <div>
            <button
              className="btn primary"
              type="button"
              onClick={() => void installHooksViaTauri()}
            >
              安装 / 导出 Hooks
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
