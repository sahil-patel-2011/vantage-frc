"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { Modal } from "./modal";
import styles from "./ui.module.css";

export type ConfirmOpts = {
  title: string;
  /** MANDATORY — must name the item/count + blast radius. Never generic "Are you sure?". */
  body: ReactNode;
  /** Action-specific: "Delete battery", "Disconnect GitHub" — never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** critical = type-to-confirm; reserved for org-wide / irreversible. */
  tone?: "destructive" | "critical";
  /** For critical: the resource name or literal "DELETE" the user must type. */
  confirmPhrase?: string;
};

/** Standalone controlled confirm dialog (Cancel default-focused; critical adds type-to-confirm). */
export function ConfirmDialog({
  open,
  opts,
  onResolve,
}: {
  open: boolean;
  opts: ConfirmOpts | null;
  onResolve: (ok: boolean) => void;
}) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      // Cancel is the default focus (safe action).
      const id = window.setTimeout(() => cancelRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  if (!opts) return null;
  const critical = opts.tone === "critical";
  const phrase = opts.confirmPhrase ?? "DELETE";
  const confirmDisabled = critical && typed.trim() !== phrase;

  return (
    <Modal open={open} onClose={() => onResolve(false)} title={opts.title} hideClose>
      <div className={styles.dialogBody}>
        <p style={{ margin: 0 }}>{opts.body}</p>
        {critical ? (
          <div style={{ marginTop: 14 }}>
            <label className={styles.dialogLabel} htmlFor="confirm-phrase" style={{ display: "block", marginBottom: 6 }}>
              Type <strong style={{ color: "var(--soft-ink)" }}>{phrase}</strong> to confirm
            </label>
            <input
              id="confirm-phrase"
              className={styles.confirmInput}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              // Critical requires a deliberate click, not Enter.
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.dialogActions}>
        <button
          ref={cancelRef}
          type="button"
          className={[styles.btn, styles.btnSm, styles.btnSecondary].join(" ")}
          onClick={() => onResolve(false)}
        >
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <Button variant="danger" size="sm" disabled={confirmDisabled} onClick={() => onResolve(true)}>
          {opts.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mount once (e.g. inside app-shell or a page root). Provides useConfirm().
 * Replaces window.confirm with a portal + focus-trapped dialog.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOpts | null; open: boolean }>({
    opts: null,
    open: false,
  });
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setState({ opts, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const onResolve = useCallback((ok: boolean) => {
    setState((s) => ({ ...s, open: false }));
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog open={state.open} opts={state.opts} onResolve={onResolve} />
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm({…})) …`. Requires <ConfirmProvider>. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
