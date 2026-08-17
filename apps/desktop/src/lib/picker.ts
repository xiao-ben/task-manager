/** 展示名：工作区文件去掉后缀，目录取最后一段 */
export function displayName(p: string): string {
  const base = dirBasename(p);
  return base.replace(/\.code-workspace$/i, "") || base;
}

export function dirBasename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** 是否为 .code-workspace 工作区文件路径 */
export function isWorkspaceFile(p: string): boolean {
  return p.toLowerCase().endsWith(".code-workspace");
}

/**
 * 选择本地代码目录或 .code-workspace 工作区。
 * 返回值保持原路径（工作区文件不会被收成父目录）。
 * 非 Tauri 环境返回 null，由调用方降级到 Cursor 最近列表。
 */
export async function pickDirectory(): Promise<string | null> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");

    const pickWorkspaceFile = await dialog.ask(
      "「是」→ 选择 .code-workspace 工作区文件\n「否」→ 选择普通代码文件夹",
      {
        title: "选择仓库类型",
        kind: "info",
        okLabel: "Workspace 文件",
        cancelLabel: "代码文件夹",
      },
    );

    const selected = pickWorkspaceFile
      ? await dialog.open({
          directory: false,
          multiple: false,
          title: "选择 .code-workspace 工作区",
          filters: [
            { name: "VS Code / Cursor Workspace", extensions: ["code-workspace"] },
          ],
        })
      : await dialog.open({
          directory: true,
          multiple: false,
          title: "选择代码目录",
        });

    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}
