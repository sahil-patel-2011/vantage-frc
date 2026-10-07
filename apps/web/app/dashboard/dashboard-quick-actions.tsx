"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button, FormRow, Modal } from "../../components/ui";
import type { DashboardWidgetType } from "../../lib/dashboard/catalog";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import "../scouting/scouting.css";
import "./dashboard-customization.css";

const ScoutingClient = dynamic(() => import("../scouting/scouting-client"), {
  loading: () => <p role="status">Loading scouting form…</p>,
  ssr: false,
});

type Action = "task" | "scouting";
const ActionsContext = createContext<{
  orgId: string;
  role: string | null;
  open: (action: Action) => void;
  refresh: (type: DashboardWidgetType) => Promise<void>;
} | null>(null);

export function useDashboardActions() {
  return useContext(ActionsContext);
}

export function DashboardActionsProvider({ orgId, role, refresh, children }: {
  orgId: string;
  role: string | null;
  refresh: (type: DashboardWidgetType) => Promise<void>;
  children: ReactNode;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const close = useCallback(() => setAction(null), []);
  return (
    <ActionsContext.Provider value={{ orgId, role, open: setAction, refresh }}>
      {children}
      <Modal open={action !== null} onClose={close}
        title={action === "task" ? "Create team task" : "Log scouting report"}
        description="Work here without leaving your dashboard."
        className="dash-action-dialog">
        {action === "task" ? <QuickTaskForm orgId={orgId} onSaved={() => refresh("team_todos")} /> : null}
        {action === "scouting" ? <ScoutingClient orgId={orgId} embedded /> : null}
      </Modal>
    </ActionsContext.Provider>
  );
}

const TASK_CARDS = new Set<DashboardWidgetType>();
const SCOUT_CARDS = new Set<DashboardWidgetType>([
  // Not the Next match card: it was the only card on a default Home with a ••• menu, and
  // offered "Log a scouting report" and "Refresh" even when the event was over.
  "match_schedule",
  "alliance_desk",
]);

export function DashboardCardActions({ type, label }: { type: DashboardWidgetType; label: string }) {
  const actions = useContext(ActionsContext);
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const offerTask = TASK_CARDS.has(type);
  const offerScout = SCOUT_CARDS.has(type);
  if (!actions || (!offerTask && !offerScout)) return null;
  function open(action: Action) {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    actions?.open(action);
  }
  async function refresh() {
    if (!actions || busy) return;
    if (menu.current) menu.current.open = false;
    setBusy(true);
    setMessage("");
    try {
      await actions.refresh(type);
      setMessage("Card refreshed.");
    } catch {
      setMessage("Could not refresh. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dash-card-action-bar">
      <span role="status">{busy ? "Refreshing…" : message}</span>
      <details ref={menu} className="dash-card-actions" onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label={`Quick actions for ${label}`}>•••</summary>
        <div className="dash-card-action-options">
          {offerTask ? <button type="button" disabled={!actions.orgId} onClick={() => open("task")}>Add a task</button> : null}
          {offerScout ? <button type="button" disabled={!actions.orgId} onClick={() => open("scouting")}>Log a scouting report</button> : null}
          <button type="button" disabled={!actions.orgId || busy} onClick={() => void refresh()}>Refresh</button>
        </div>
      </details>
    </div>
  );
}

function QuickTaskForm({ orgId, onSaved }: { orgId: string; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  return (
    <form className="dash-quick-task" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || requestRef.current || !title.trim() || !orgId) return;
      const controller = new AbortController();
      requestRef.current = controller;
      setBusy(true);
      setMessage("");
      setError("");
      try {
        const response = await fetch("/api/todos", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action: "create-todo", title: title.trim(), notes: notes.trim(), dueOn: dueOn || null }),
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || data.status !== "live") throw new Error(data.error || "Could not create the task.");
        setTitle(""); setNotes(""); setDueOn("");
        setMessage("Team task created.");
        try { await onSaved(); } catch { if (!controller.signal.aborted) setMessage("Team task created. Refresh the card to see it."); }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === "TimeoutError") {
          setError("Couldn’t confirm the task. Open Team tasks to check before creating it again.");
          return;
        }
        setError(cause instanceof Error ? cause.message : "Could not create the task. Please try again.");
      } finally { if (!controller.signal.aborted) { requestRef.current = null; setBusy(false); } }
    }}>
      <FormRow label="Task title"><input aria-label="Task title" required disabled={busy} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></FormRow>
      <FormRow label="Due date"><input aria-label="Due date" type="date" disabled={busy} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></FormRow>
      <FormRow label="Notes"><textarea aria-label="Notes" disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormRow>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !orgId || !title.trim()}>{busy ? "Creating…" : "Create task"}</Button>
    </form>
  );
}
