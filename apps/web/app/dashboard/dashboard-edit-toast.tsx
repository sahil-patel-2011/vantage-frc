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
  sticky,
  onUndo,
  onDismiss,
}: {
  message: string;
  kind: "success" | "error";
  action: "undo" | null;
  /** Sits above the edit toolbar rather than the app's tab bar. */
  editing: boolean;
  /** Stays until the step it describes is done (e.g. "Tap a slot…"). */
  sticky: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message || sticky) return;
    const timer = window.setTimeout(onDismiss, kind === "error" ? 9000 : action ? 7000 : 4500);
    return () => window.clearTimeout(timer);
  }, [message, kind, action, sticky, onDismiss]);

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
      <button type="button" className="dash-toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
