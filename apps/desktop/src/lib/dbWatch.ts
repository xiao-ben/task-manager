type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;
let lastSig = "";
let timer: number | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readSignature(): Promise<string> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const mtime = (await invoke("local_db_mtime")) as number | null;
      if (mtime != null) return `mtime:${mtime}`;
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem("task-manager.local.db") ?? "";
    return `ls:${raw.length}:${raw.slice(0, 32)}`;
  } catch {
    return "";
  }
}

async function tick() {
  if (document.visibilityState === "hidden") return;
  try {
    const sig = await readSignature();
    if (sig && lastSig && sig !== lastSig) {
      for (const l of listeners) l();
    }
    if (sig) lastSig = sig;
  } catch {
    /* ignore */
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  void readSignature().then((s) => {
    lastSig = s;
  });
  timer = window.setInterval(() => void tick(), 2000);
  window.addEventListener("focus", () => void tick());
  document.addEventListener("visibilitychange", () => void tick());
}

/** Subscribe to local DB file / storage changes (Hooks / other windows). */
export function subscribeLocalDbWatch(listener: Listener): () => void {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      window.clearInterval(timer);
      timer = null;
      started = false;
    }
  };
}

/** Force next tick to treat current state as baseline (after our own write). */
export async function bumpLocalDbWatchBaseline(): Promise<void> {
  lastSig = await readSignature();
}
