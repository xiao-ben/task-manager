/** 用 Cursor 客户端打开本地目录/文件 */
export async function openInCursor(path: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_in_cursor", { path });
    return;
  } catch (err) {
    // 非 Tauri 或命令失败时降级
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("not allowed") && !msg.includes("plugin")) {
      // Tauri 内已有明确错误，继续尝试 deeplink 兜底
    }
  }

  const url = `cursor://file${path}`;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  } catch {
    /* 浏览器降级 */
  }

  const a = document.createElement("a");
  a.href = url;
  a.rel = "noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
