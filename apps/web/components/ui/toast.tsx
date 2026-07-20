"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "info" | "error";
type ToastOptions = {
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  /** Overrides the default (success/info auto-dismiss; error persists). */
  durationMs?: number;
};

type ToastItem = {
  id: number;
  msg: ReactNode;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
  durationMs: number | null;
  count: number;
  key: string;
};

type ToastApi = {
  toast: (msg: ReactNode, opts?: ToastOptions) => void;
  success: (msg: ReactNode, opts?: ToastOptions) => void;
  info: (msg: ReactNode, opts?: ToastOptions) => void;
  error: (msg: ReactNode, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 3;

/** Mount once (e.g. app-shell). Built on the existing .soft-toast-stack / .soft-toast CSS. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const arm = useCallback(
    (id: number, ms: number | null) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      if (ms != null) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const push = useCallback(
    (msg: ReactNode, opts?: ToastOptions) => {
      const variant = opts?.variant ?? "info";
      const isBlocking = variant === "error";
      const durationMs = opts?.durationMs ?? (isBlocking ? null : 5000);
      const key = typeof msg === "string" ? `${variant}:${msg}` : "";

      setItems((list) => {
        // De-dupe identical messages by bumping a counter (rapid autosave "Saved").
        if (key) {
          const dupe = list.find((t) => t.key === key);
          if (dupe) {
            arm(dupe.id, durationMs);
            return list.map((t) => (t.id === dupe.id ? { ...t, count: t.count + 1 } : t));
          }
        }
        const id = ++seq.current;
        arm(id, durationMs);
        return [...list, { id, msg, variant, action: opts?.action, durationMs, count: 1, key }];
      });
    },
    [arm],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (m, o) => push(m, { ...o, variant: "success" }),
      info: (m, o) => push(m, { ...o, variant: "info" }),
      error: (m, o) => push(m, { ...o, variant: "error" }),
    }),
    [push],
  );

  const visible = items.slice(-MAX_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="soft-toast-stack">
        {hidden > 0 ? (
          <div className="soft-toast" aria-hidden="true">
            <strong>+{hidden} more</strong>
          </div>
        ) : null}
        {visible.map((t) => {
          const blocking = t.variant === "error";
          return (
            <div
              key={t.id}
              className={["soft-toast", t.variant === "success" ? "ok" : "", blocking ? "bad" : ""]
                .filter(Boolean)
                .join(" ")}
              role={blocking ? "alert" : "status"}
              aria-live={blocking ? "assertive" : "polite"}
              onMouseEnter={() => arm(t.id, null)}
              onMouseLeave={() => arm(t.id, t.durationMs)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                <strong style={{ fontSize: 13 }}>
                  {t.msg}
                  {t.count > 1 ? ` (×${t.count})` : ""}
                </strong>
                <span style={{ display: "inline-flex", gap: 8, flex: "none" }}>
                  {t.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                      style={{
                        border: 0,
                        background: "none",
                        padding: 0,
                        color: "inherit",
                        font: "inherit",
                        fontWeight: 700,
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss"
                    style={{ border: 0, background: "none", padding: 0, color: "inherit", cursor: "pointer", opacity: 0.7 }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** `const { success, error } = useToast();`. Requires <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
