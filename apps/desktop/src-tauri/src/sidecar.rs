use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

pub const SIDECAR_PORT: u16 = 3927;

pub struct SidecarState {
    /// Child process we spawned (kill only this on exit).
    pub child: Mutex<Option<Child>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

fn runtime_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".cursor/task-manager/sidecar-runtime.json"))
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct RuntimeConfig {
    /// Absolute path to sidecar entry (`.ts` or `.mjs`)
    script: Option<String>,
    /// Working directory for the process (for `.env` / node_modules)
    cwd: Option<String>,
    node: Option<String>,
}

fn load_runtime_config() -> RuntimeConfig {
    let Some(path) = runtime_config_path() else {
        return RuntimeConfig::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return RuntimeConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_runtime_config(cfg: &RuntimeConfig) {
    let Some(path) = runtime_config_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, text);
    }
}

pub fn sidecar_healthy() -> bool {
    let addr = format!("127.0.0.1:{SIDECAR_PORT}");
    let Ok(mut stream) =
        TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(400))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "GET /health HTTP/1.0\r\nHost: 127.0.0.1:{SIDECAR_PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let body = String::from_utf8_lossy(&buf);
    body.contains("200") && body.contains("\"ok\"")
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn find_node(hint: Option<&str>) -> Option<PathBuf> {
    if let Some(h) = hint {
        let p = PathBuf::from(h);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(p) = which_in_path("node") {
        return Some(p);
    }
    // Common nvm / Homebrew locations on macOS
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".nvm/versions/node/v22.23.1/bin/node"),
        home.join(".nvm/versions/node/v22.14.0/bin/node"),
        home.join(".local/share/fnm/node-versions"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    // Newest nvm node if present
    let nvm = home.join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(&nvm) {
        let mut versions: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        versions.sort();
        if let Some(latest) = versions.last() {
            let node = latest.join("bin/node");
            if node.is_file() {
                return Some(node);
            }
        }
    }
    None
}

fn monorepo_sidecar_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../sidecar/src/index.ts")
}

fn candidate_scripts(app: &AppHandle) -> Vec<(PathBuf, PathBuf)> {
    // (script, cwd)
    let mut out = Vec::new();

    if let Ok(script) = std::env::var("TASK_MANAGER_SIDECAR_SCRIPT") {
        let script = PathBuf::from(script);
        let cwd = script
            .parent()
            .and_then(|p| {
                if p.file_name().and_then(|n| n.to_str()) == Some("src") {
                    p.parent().map(|x| x.to_path_buf())
                } else {
                    Some(p.to_path_buf())
                }
            })
            .unwrap_or_else(|| PathBuf::from("."));
        out.push((script, cwd));
    }

    let rt = load_runtime_config();
    if let Some(script) = rt.script.as_ref() {
        let script = PathBuf::from(script);
        let cwd = rt
            .cwd
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| script.parent().unwrap_or(Path::new(".")).to_path_buf());
        out.push((script, cwd));
    }

    let baked = monorepo_sidecar_script();
    if let Ok(canon) = fs::canonicalize(&baked) {
        let cwd = canon
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(Path::new("."))
            .to_path_buf();
        out.push((canon, cwd));
    } else if baked.exists() {
        let cwd = baked
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(Path::new("."))
            .to_path_buf();
        out.push((baked, cwd));
    }

    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("sidecar/server.mjs");
        if bundled.exists() {
            let cwd = bundled.parent().unwrap_or(Path::new(".")).to_path_buf();
            out.push((bundled, cwd));
        }
    }

    if let Some(home) = dirs::home_dir() {
        let installed = home.join(".cursor/task-manager/sidecar/server.mjs");
        if installed.exists() {
            let cwd = installed.parent().unwrap_or(Path::new(".")).to_path_buf();
            out.push((installed, cwd));
        }
    }

    out
}

fn spawn_sidecar_process(node: &Path, script: &Path, cwd: &Path) -> Result<Child, String> {
    let mut cmd = Command::new(node);
    // TypeScript entry: Node 22+ strip-types; .mjs/.js run directly
    let is_ts = script
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e == "ts" || e == "mts" || e == "cts");
    if is_ts {
        cmd.arg("--experimental-strip-types");
    }
    cmd.arg(script)
        .current_dir(cwd)
        .env("SIDECAR_PORT", SIDECAR_PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Prefer detaching so a crash of the UI doesn't always leave zombies inconsistently;
    // we still keep the Child handle to kill on quit.
    cmd.spawn()
        .map_err(|e| format!("启动 sidecar 失败：{e}（node={}, script={}）", node.display(), script.display()))
}

fn wait_until_healthy(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if sidecar_healthy() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Ensure local sidecar is up. Returns a short status string.
pub fn ensure_sidecar(app: &AppHandle, state: &SidecarState) -> Result<String, String> {
    if sidecar_healthy() {
        return Ok("already_running".into());
    }

    // If we previously spawned a dead child, clear it
    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = guard.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                *guard = None;
            }
        }
        if guard.is_some() {
            // Process still alive but health failed — give it a moment
            drop(guard);
            if wait_until_healthy(Duration::from_secs(2)) {
                return Ok("starting".into());
            }
        }
    }

    let rt = load_runtime_config();
    let node = find_node(rt.node.as_deref()).ok_or_else(|| {
        "未找到 Node.js（需要 >= 22）。请安装 Node 或设置 PATH。".to_string()
    })?;

    let mut last_err = "未找到 sidecar 入口脚本".to_string();
    for (script, cwd) in candidate_scripts(app) {
        if !script.exists() {
            continue;
        }
        match spawn_sidecar_process(&node, &script, &cwd) {
            Ok(child) => {
                {
                    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
                    *guard = Some(child);
                }
                if wait_until_healthy(Duration::from_secs(8)) {
                    save_runtime_config(&RuntimeConfig {
                        script: Some(script.display().to_string()),
                        cwd: Some(cwd.display().to_string()),
                        node: Some(node.display().to_string()),
                    });
                    return Ok("started".into());
                }
                // Spawned but unhealthy — kill and try next
                if let Ok(mut guard) = state.child.lock() {
                    if let Some(mut c) = guard.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }
                // Another process may have bound the port concurrently
                if sidecar_healthy() {
                    return Ok("already_running".into());
                }
                last_err = format!(
                    "sidecar 已启动但健康检查失败（script={}）",
                    script.display()
                );
            }
            Err(e) => {
                if wait_until_healthy(Duration::from_secs(2)) {
                    return Ok("already_running".into());
                }
                last_err = e;
            }
        }
    }

    Err(last_err)
}

pub fn stop_owned_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub fn ensure_sidecar_cmd(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<String, String> {
    ensure_sidecar(&app, &state)
}

#[tauri::command]
pub fn sidecar_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "healthy": sidecar_healthy(),
        "url": format!("http://127.0.0.1:{SIDECAR_PORT}"),
    }))
}
