"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPresence } from "./use-exit-presence";
import styles from "./ui.module.css";

export function useDialog(initial = false) {
  const [open, setOpen] = useState(initial);
  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  return { open, openDialog, closeDialog, setOpen };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
// Effects register only browser-mounted dialogs. The top dialog alone owns
// keyboard input; the first lock preserves the page's original scroll style.
const activeDialogs: HTMLElement[] = [];
let overflowBeforeDialogs: string | null = null;
let focusBeforeDialogs: HTMLElement | null = null;
const visibleControl = (el: HTMLElement) => !el.closest('[hidden], [inert], [aria-hidden="true"]') && !el.matches(":disabled") && el.getClientRects().length > 0;

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  labelledById?: string;
  /** Hide the default close (X) button. */
  hideClose?: boolean;
  className?: string;
  /** Centered dialog by default; sheet docks to the bottom for mobile-first pickers. */
  variant?: "dialog" | "sheet";
};

const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Accessible modal — focus trap (Tab/Shift+Tab cycle), Escape-to-close, focus RETURNED to the
 * invoking element on close, role="dialog" aria-modal aria-labelledby. No library. Portal to body.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  description,
  labelledById,
  hideClose,
  className,
  variant = "dialog",
}: ModalProps) {
  const presence = useExitPresence(open);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const autoId = useId();
  const titleId = labelledById ?? `modal-title-${autoId}`;
  const descriptionId = `modal-description-${autoId}`;
  const [mounted, setMounted] = useState(false);
  // The latest onClose, read by the key handler. Callers pass a new function every render;
  // with onClose in the effect's deps the trap re-ran on each keystroke and pulled focus back
  // to the Close button, so typing in a field inside the dialog lost every key after the first.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const node = dialogRef.current;
    if (!node) return;
    if (!activeDialogs.length) {
      overflowBeforeDialogs = document.body.style.overflow;
      focusBeforeDialogs = restoreRef.current;
      document.body.style.overflow = "hidden";
    }
    activeDialogs.push(node);
    // Focus what the dialog asks for (autoFocus / data-autofocus), else the first control in its
    // body, else the first control at all, else the dialog itself. Never steal focus that is
    // already inside it.
    if (!node?.contains(document.activeElement)) {
      const wanted =
        Array.from(node.querySelectorAll<HTMLElement>("[autofocus], [data-autofocus]")).find(visibleControl) ??
        Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => visibleControl(el) && el.getAttribute("aria-label") !== "Close dialog") ??
        Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visibleControl);
      (wanted ?? node)?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (activeDialogs.at(-1) !== node) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visibleControl);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && (active === firstEl || !node.contains(active) || active === node)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !node.contains(active) || active === node)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const wasTop = activeDialogs.at(-1) === node;
      const index = activeDialogs.indexOf(node);
      if (index !== -1) activeDialogs.splice(index, 1);
      if (!activeDialogs.length) {
        document.body.style.overflow = overflowBeforeDialogs ?? "";
        overflowBeforeDialogs = null;
      }
      if (wasTop) {
        const top = activeDialogs.at(-1);
        const restore = restoreRef.current;
        if (restore?.isConnected && visibleControl(restore) && (!top || top.contains(restore))) restore.focus();
        else if (top) top.focus();
        else if (focusBeforeDialogs?.isConnected && visibleControl(focusBeforeDialogs)) focusBeforeDialogs.focus();
      }
      if (!activeDialogs.length) focusBeforeDialogs = null;
    };
  }, [open, mounted]);

  if (!presence.present || !mounted) return null;

  return createPortal(
    <div
      className={[styles.overlay, variant === "sheet" ? styles.sheetOverlay : ""].filter(Boolean).join(" ")}
      data-closing={presence.closing || undefined}
      aria-hidden={presence.closing || undefined}
      inert={presence.closing}
      onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={open || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[styles.dialog, variant === "sheet" ? styles.sheet : "", className].filter(Boolean).join(" ")}
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id={titleId} className={styles.dialogTitle}>
              {title}
            </h2>
            {description ? <p id={descriptionId} className={styles.dialogBody}>{description}</p> : null}
          </div>
          {!hideClose ? (
            <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="Close dialog">
              <CloseGlyph />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
