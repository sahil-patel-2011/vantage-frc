"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../../hooks/use-dismiss";
import "./page-options.css";

/**
 * A disclosure for controls that do not fit the toolbar.
 *
 * DEPRECATED 2026-10-26 as the page-header overflow named "Page options".
 * Page and card toolbars use PageToolbar, which files extra actions under More.
 * This menu remains for surfaces that still mount their own extra controls.
 */
export function PageOptions({ children, label = "Page options" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = () => {
    // Portalled menus and dialogs own dismissal until their layer has closed.
    if (document.activeElement?.closest('[role="dialog"], [role="menu"]')) return;
    const node = ref.current;
    if (node?.contains(document.activeElement)) node.querySelector("summary")?.focus();
    node?.removeAttribute("open");
    setOpen(false);
  };
  const ref = useDismiss<HTMLDetailsElement>(open, close);
  const panelRef = useRef<HTMLDivElement>(null);
  return (
    <details ref={ref} className="page-options" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary aria-controls={panelId} aria-expanded={open} onKeyDown={event => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        ref.current?.setAttribute("open", "");
        panelRef.current?.querySelector<HTMLElement>('button:not(:disabled), a[href], input, select, summary')?.focus();
      }}><span>{label}</span><span aria-hidden="true">•••</span></summary>
      <div ref={panelRef} id={panelId} className="page-options-panel" role="group" aria-label={label}>{children}</div>
    </details>
  );
}
