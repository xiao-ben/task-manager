export async function updateTrayBadge(count: number) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_title", {
      title: count > 0 ? String(count) : "",
    });
  } catch {
    // browser / non-tauri
  }
}
