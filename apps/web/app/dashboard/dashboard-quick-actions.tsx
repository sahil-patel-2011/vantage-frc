"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button, FormRow, Modal } from "../../components/ui";
import type { DashboardWidgetType } from "../../lib/dashboard/catalog";
import "../scouting/scouting.css";
import "./dashboard-customization.css";

const ScoutingClient = dynamic(() => import("../scouting/scouting-client"), {
  loading: () => <p role="status">Loading scouting form…</p>,
  ssr: false,
});

type Action = "task" | "scouting";
const ActionsContext = createContext<{
  orgId: string;
  open: (action: Action) => void;
  refresh: (type: DashboardWidgetType) => Promise<void>;
} | null>(null);

export function DashboardActionsProvider({ orgId, refresh, children }: {
  orgId: string;
  refresh: (type: DashboardWidgetType) => Promise<void>;
  children: ReactNode;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const close = useCallback(() => setAction(null), []);
  return (
    <ActionsContext.Provider value={{ orgId, open: setAction, refresh }}>
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

export function DashboardCardActions({ type, label }: { type: DashboardWidgetType; label: string }) {
  const actions = useContext(ActionsContext);
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!actions) return null;
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
          <button type="button" disabled={!actions.orgId} onClick={() => open("task")}>Create team task</button>
          <button type="button" disabled={!actions.orgId} onClick={() => open("scouting")}>Log scouting report</button>
          <button type="button" disabled={!actions.orgId || busy} onClick={() => void refresh()}>Refresh card data</button>
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
  return (
    <form className="dash-quick-task" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || !title.trim() || !orgId) return;
      setBusy(true);
      setMessage("");
      setError("");
      try {
        const response = await fetch("/api/todos", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action: "create-todo", title: title.trim(), notes: notes.trim(), dueOn: dueOn || null }),
        });
        const data = await response.json();
        if (!response.ok || data.status !== "live") throw new Error(data.error || "Could not create the task.");
        setTitle(""); setNotes(""); setDueOn("");
        setMessage("Team task created.");
        try { await onSaved(); } catch { setMessage("Team task created. Refresh the card to see it."); }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not create the task. Please try again.");
      } finally { setBusy(false); }
    }}>
      <FormRow label="Task title"><input aria-label="Task title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></FormRow>
      <FormRow label="Due date"><input aria-label="Due date" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></FormRow>
      <FormRow label="Notes"><textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></FormRow>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !orgId || !title.trim()}>{busy ? "Creating…" : "Create task"}</Button>
    </form>
  );
}
