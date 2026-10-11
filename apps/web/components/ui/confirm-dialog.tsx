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
  /**
   * critical = type-to-confirm; reserved for org-wide / irreversible. neutral = a yes that
   * loses nothing (sharing, publishing), so its button is not painted like a delete.
   */
  tone?: "destructive" | "critical" | "neutral";
  /** For critical: the resource name or literal "DELETE" the user must type. */
  confirmPhrase?: string;
  /**
   * A text answer to collect with the yes (a reason, a note, an address). askText() resolves
   * to it; the field takes focus, and Enter answers a one-line field.
   */
  input?: { label: string; initial?: string; placeholder?: string; required?: boolean; multiline?: boolean; type?: "text" | "email" };
};

type Answer = { ok: boolean; value: string };

/** Standalone controlled confirm dialog (Cancel default-focused; critical adds type-to-confirm). */
export function ConfirmDialog({
  open,
  opts,
  onResolve,
}: {
  open: boolean;
  opts: ConfirmOpts | null;
  onResolve: (ok: boolean, value?: string) => void;
}) {
  const [lastOpts, setLastOpts] = useState(opts);
  useEffect(() => { if (opts) setLastOpts(opts); }, [opts]);
  const visibleOpts = opts ?? lastOpts;
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState("");
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const answerRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const initialAnswer = opts?.input?.initial ?? "";
  const asksText = Boolean(opts?.input);

  useEffect(() => {
    if (open) {
      setTyped("");
      setAnswer(initialAnswer);
      // Cancel is the default focus (safe action); a question with a text field focuses the field.
      const id = window.setTimeout(() => (asksText ? answerRef.current : cancelRef.current)?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, asksText, initialAnswer]);

  if (!visibleOpts) return null;
  const critical = visibleOpts.tone === "critical";
  const phrase = visibleOpts.confirmPhrase ?? "DELETE";
  const input = visibleOpts.input;
  const confirmDisabled = (critical && typed.trim() !== phrase) || Boolean(input?.required && !answer.trim());

  return (
    <Modal open={open} onClose={() => onResolve(false)} title={visibleOpts.title} hideClose>
      <div className={styles.dialogBody}>
        {visibleOpts.body ? <p style={{ margin: 0 }}>{visibleOpts.body}</p> : null}
        {input ? (
          <label style={{ display: "grid", gap: 6, marginTop: visibleOpts.body ? 14 : 0, color: "var(--muted)", font: "600 13px/1.3 var(--font-sans)" }}>
            {input.label}
            {input.multiline ? (
              <textarea
                ref={answerRef}
                className={styles.confirmInput}
                rows={3}
                value={answer}
                placeholder={input.placeholder}
                onChange={(e) => setAnswer(e.target.value)}
              />
            ) : (
              <input
                ref={answerRef}
                className={styles.confirmInput}
                type={input.type ?? "text"}
                value={answer}
                placeholder={input.placeholder}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !confirmDisabled) {
                    e.preventDefault();
                    onResolve(true, answer);
                  }
                }}
              />
            )}
          </label>
        ) : null}
        {critical ? (
          <div style={{ marginTop: 14 }}>
            <label className={styles.stackKey} htmlFor="confirm-phrase" style={{ display: "block", marginBottom: 6 }}>
              Type <strong style={{ color: "var(--ink)" }}>{phrase}</strong> to confirm
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
          {visibleOpts.cancelLabel ?? "Cancel"}
        </button>
        <Button
          variant={visibleOpts?.tone === "neutral" ? "primary" : "danger"}
          size="sm"
          disabled={confirmDisabled}
          onClick={() => onResolve(true, answer)}
        >
          {visibleOpts.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Mounted providers, innermost last; askConfirm() and askText() ask through the innermost one. */
const mounted: Array<(opts: ConfirmOpts) => Promise<Answer>> = [];

/**
 * The same dialog as useConfirm(), for a click handler in a component that does not hold the
 * hook: `onClick={async () => { if (await askConfirm({…})) remove(); }}`. A ConfirmProvider is
 * always mounted under the app's ThemeProvider; without one it falls back to the browser box.
 */
export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  const ask = mounted[mounted.length - 1];
  if (ask) return ask(opts).then((answer) => answer.ok);
  return Promise.resolve(typeof window !== "undefined" && window.confirm(opts.title));
}

/**
 * The app's dialog with a text field, in place of window.prompt(): resolves to what was typed,
 * or null on Cancel. `const reason = await askText({ title, body, confirmLabel, input: { label } })`.
 */
export function askText(opts: ConfirmOpts & { input: NonNullable<ConfirmOpts["input"]> }): Promise<string | null> {
  const ask = mounted[mounted.length - 1];
  if (ask) return ask(opts).then((answer) => (answer.ok ? answer.value : null));
  return Promise.resolve(typeof window === "undefined" ? null : window.prompt(opts.title, opts.input.initial ?? ""));
}

/**
 * Mount once (e.g. inside app-shell or a page root). Provides useConfirm().
 * Replaces window.confirm with a portal + focus-trapped dialog.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOpts | null; open: boolean }>({
    opts: null,
    open: false,
  });
  const resolver = useRef<((answer: Answer) => void) | null>(null);

  const ask = useCallback((opts: ConfirmOpts) => {
    // Resolve the previous caller before replacing its dialog.
    resolver.current?.({ ok: false, value: "" });
    setState({ opts, open: true });
    return new Promise<Answer>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const confirm = useCallback<ConfirmFn>((opts) => ask(opts).then((answer) => answer.ok), [ask]);

  useEffect(() => () => {
    resolver.current?.({ ok: false, value: "" });
    resolver.current = null;
  }, []);

  useEffect(() => {
    mounted.push(ask);
    return () => {
      const at = mounted.lastIndexOf(ask);
      if (at >= 0) mounted.splice(at, 1);
    };
  }, [ask]);

  const onResolve = useCallback((ok: boolean, value?: string) => {
    setState((s) => ({ ...s, open: false }));
    resolver.current?.({ ok, value: value ?? "" });
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
