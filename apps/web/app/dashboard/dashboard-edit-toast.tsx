"use client";

import { useEffect } from "react";

/*
  Status for Home, shown where you are looking. Edit messages ("Hours this
  month removed") used to appear at the top of the page while you were working
  on cards further down, so nobody saw them — and "removed" had no way back.
  The toast sits just above the edit toolbar, carries Undo when there is
  something to undo, and clears itself.
*/
export function DashboardEditToast({
  message,
  kind,
  action,
  editing,
  onUndo,
  onDismiss,
  secondary = null,
}: {
  /** A follow-up other than Undo, e.g. "Open team board" after sharing. */
  secondary?: { label: string; testId: string; onClick: () => void } | null;
  message: string;
  kind: "success" | "error";
  action: "undo" | null;
  /** Sits above the edit toolbar rather than the app's tab bar. */
  editing: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const hasSecondary = Boolean(secondary);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, kind === "error" ? 9000 : action || hasSecondary ? 7000 : 4500);
    return () => window.clearTimeout(timer);
    // A boolean, not the object: the parent builds a new one every render.
  }, [message, kind, action, hasSecondary, onDismiss]);

  if (!message) return null;
  return (
    <div
      className={`dash-toast${editing ? " is-editing" : ""}`}
      data-kind={kind}
      role={kind === "error" ? "alert" : "status"}
      data-testid="dash-toast"
    >
      <span>{message}</span>
      {action === "undo" ? (
        <button type="button" data-testid="dash-toast-undo" onClick={onUndo}>
          Undo
        </button>
      ) : null}
      {secondary ? (
        <button type="button" className="dash-toast-action" data-testid={secondary.testId} onClick={secondary.onClick}>
          {secondary.label}
        </button>
      ) : null}
      <button type="button" className="dash-toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
