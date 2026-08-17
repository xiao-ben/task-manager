mod sidecar;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use sidecar::{ensure_sidecar, ensure_sidecar_cmd, sidecar_status, stop_owned_sidecar, SidecarState};

#[tauri::command]
fn install_cursor_hooks(
    hooks_json: String,
    env_json: String,
    scripts: HashMap<String, String>,
) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("HOME not found")?;
    let cursor_dir = home.join(".cursor");
    let hooks_dir = cursor_dir.join("hooks");
    fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;

    fs::write(cursor_dir.join("task-manager.env.json"), env_json)
        .map_err(|e| e.to_string())?;

    for (name, content) in scripts {
        let path = hooks_dir.join(&name);
        fs::write(&path, content).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
        }
    }

    let hooks_path = cursor_dir.join("hooks.json");
    merge_hooks_json(&hooks_path, &hooks_json)?;
    Ok(hooks_path.display().to_string())
}

fn merge_hooks_json(path: &PathBuf, snippet: &str) -> Result<(), String> {
    let snippet_val: serde_json::Value =
        serde_json::from_str(snippet).map_err(|e| e.to_string())?;
    let mut base = if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({ "version": 1, "hooks": {} }))
    } else {
        serde_json::json!({ "version": 1, "hooks": {} })
    };

    let snippet_hooks = snippet_val
        .get("hooks")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    if let Some(obj) = base.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        if let Some(map) = snippet_hooks.as_object() {
            for (k, v) in map {
                obj.insert(k.clone(), v.clone());
            }
        }
    } else {
        base["hooks"] = snippet_hooks;
    }
    base["version"] = serde_json::json!(1);
    fs::write(path, serde_json::to_string_pretty(&base).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_widget(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_widget(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_in_cursor(path: String) -> Result<(), String> {
    use std::process::Command;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在：{path}"));
    }

    // 优先走 Cursor CLI + --classic：新版默认可能进 Glass/Agents，而不是经典 IDE
    let cursor_bins = [
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        "/Applications/Cursor.app/Contents/MacOS/Cursor",
    ];
    for bin in cursor_bins {
        if !PathBuf::from(bin).exists() {
            continue;
        }
        let status = Command::new(bin)
            .args(["--classic", "-n", &path])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }

    // 兜底：按 bundle id 打开桌面版 Cursor.app（避免被系统默认关联抢走）
    let status = Command::new("open")
        .args([
            "-b",
            "com.todesktop.230313mzl4w4u92",
            "-n",
            "--args",
            "--classic",
            &path,
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("唤起 Cursor IDE 失败，请确认已安装 /Applications/Cursor.app".into())
    }
}

#[tauri::command]
fn show_main(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(title)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn local_db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("HOME not found")?;
    Ok(home.join(".cursor").join("task-manager").join("data.json"))
}

#[tauri::command]
fn read_local_db() -> Result<String, String> {
    let path = local_db_path()?;
    if !path.exists() {
        return Ok(r#"{"tasks":[],"repos":[],"summaries":[],"agentRuns":[],"deletedTaskIds":[],"revision":1}"#.into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_local_db(json: String) -> Result<(), String> {
    // Validate JSON before writing
    let _: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("invalid json: {e}"))?;
    let path = local_db_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, contents.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_db_mtime() -> Result<Option<u64>, String> {
    let path = local_db_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let secs = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(Some(secs))
}

/// Whether a Cursor API key is already available (settings file / sidecar .env / process env).
/// Does not return the secret itself.
#[tauri::command]
fn cursor_api_key_configured() -> bool {
    if std::env::var("CURSOR_API_KEY")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".cursor/task-manager/sidecar.env"));
        candidates.push(home.join(".cursor/sidecar.env"));
    }
    // Monorepo sidecar/.env (dev and packaged app)
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../sidecar/.env"),
    );
    for path in candidates {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(rest) = line.strip_prefix("CURSOR_API_KEY=") {
                let val = rest.trim().trim_matches('"').trim_matches('\'');
                if !val.is_empty() {
                    return true;
                }
            }
        }
    }
    // Already has local data → treat as configured user
    if let Ok(path) = local_db_path() {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                let tasks = v.get("tasks").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                let repos = v.get("repos").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                if tasks + repos > 0 {
                    return true;
                }
            }
        }
    }
    false
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            install_cursor_hooks,
            show_widget,
            hide_widget,
            show_main,
            open_in_cursor,
            set_tray_title,
            read_local_db,
            write_local_db,
            write_text_file,
            read_text_file,
            local_db_mtime,
            cursor_api_key_configured,
            ensure_sidecar_cmd,
            sidecar_status,
        ])
        .setup(|app| {
            let show_widget_i =
                MenuItem::with_id(app, "show_widget", "显示小窗", true, None::<&str>)?;
            let show_main_i =
                MenuItem::with_id(app, "show_main", "打开主窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_widget_i, &show_main_i, &quit_i])?;

            // 菜单栏需黑白 template 图标；彩色 app icon 在 template 模式下会渲成白块
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("tray-icon.png");
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("任务台")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_widget" => {
                        let _ = show_widget(app.clone());
                    }
                    "show_main" => {
                        let _ = show_main(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let _ = show_widget(app.clone());
                    }
                })
                .build(app)?;

            // Ensure widget exists even if config omitted in some builds
            if app.get_webview_window("widget").is_none() {
                let _ = WebviewWindowBuilder::new(
                    app,
                    "widget",
                    WebviewUrl::App("index.html#/widget".into()),
                )
                .title("今日待办")
                .inner_size(360.0, 520.0)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .build();
            }

            // Auto-start local Cursor sidecar (HTTP :3927)
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<SidecarState>();
                match ensure_sidecar(&handle, state.inner()) {
                    Ok(status) => eprintln!("[sidecar] {status}"),
                    Err(err) => eprintln!("[sidecar] auto-start failed: {err}"),
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<SidecarState>();
            stop_owned_sidecar(state.inner());
        }
    });
}
