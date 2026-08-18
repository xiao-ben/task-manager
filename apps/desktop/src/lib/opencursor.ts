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
  await openExternalUrl(url);
}

/** 打开任意外链 / deeplink（Cursor Agents、prompt 预填等） */
export async function openExternalUrl(url: string): Promise<void> {
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
  a.target = "_blank";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 构造 Cursor prompt deeplink（需用户在客户端确认后才会执行） */
export function buildCursorPromptDeeplink(promptText: string): string {
  // 手动编码，避免部分环境下 URL/searchParams 对 cursor:// 处理异常
  const encoded = encodeURIComponent(promptText).replace(/%20/g, "+");
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encoded}`;
}

export function taskPromptText(input: {
  title: string;
  notes?: string | null;
  taskId?: string;
}): string {
  const marker = input.taskId ? `[任务台:${input.taskId}]\n` : "";
  return `${marker}请完成以下任务：${input.title}${
    input.notes?.trim() ? `\n\n备注：${input.notes.trim()}` : ""
  }`;
}

/**
 * 在经典 Cursor Chat 预填任务 query：
 * 原生命令先绑定工作区，再用 macOS open 打 deeplink（并写入剪贴板兜底）。
 */
export async function openTaskInCursorChat(input: {
  cwd: string;
  title: string;
  notes?: string | null;
  taskId?: string;
}): Promise<void> {
  const prompt = taskPromptText(input);
  const core = await import("@tauri-apps/api/core");

  if (core.isTauri()) {
    // 原生 App 失败时必须把错误显示出来，不能静默走浏览器降级，
    // 否则会在未切换工作区时直接把 query 发给当前 Agents 会话。
    await core.invoke("open_cursor_with_prompt", {
      path: input.cwd,
      prompt,
    });
    return;
  }

  // 纯浏览器调试模式没有原生命令，只能使用 deeplink 降级。
  await openInCursor(input.cwd);
  await new Promise((r) => window.setTimeout(r, 900));
  await openExternalUrl(buildCursorPromptDeeplink(prompt));
}

export function agentsUrlForId(agentId: string): string {
  return `https://cursor.com/agents/${encodeURIComponent(agentId)}`;
}
