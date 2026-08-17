import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type ToastItem = {
  id: string;
  message: string;
  kind?: "info" | "ok" | "err";
  action?: ToastAction;
  durationMs?: number;
};

type ToastApi = {
  show: (toast: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = crypto.randomUUID();
      const item: ToastItem = {
        kind: "info",
        durationMs: toast.action ? 6000 : 3200,
        ...toast,
        id,
      };
      setItems((prev) => [...prev.slice(-4), item]);
      const ms = item.durationMs ?? 3200;
      if (ms > 0) {
        const handle = window.setTimeout(() => dismiss(id), ms);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind ?? "info"}`} role="status">
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="btn sm plain toast-action"
                type="button"
                onClick={() => {
                  void Promise.resolve(t.action?.onClick()).finally(() =>
                    dismiss(t.id),
                  );
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="btn icon plain toast-close"
              type="button"
              aria-label="关闭"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => "",
      dismiss: () => {},
    };
  }
  return ctx;
}
