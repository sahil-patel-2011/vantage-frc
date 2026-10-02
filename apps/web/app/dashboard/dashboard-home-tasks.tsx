"use client";

import { useId, useRef, useState } from "react";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { Button } from "../../components/ui";
import { Icon } from "../../components/icon";
import { useDashboardActions } from "./dashboard-quick-actions";
import { homeTasks } from "./dashboard-overview-model";

/** The stock task surface uses the same authorized API as the full task page. */
export function DashboardHomeTasks({ orgId, role, payload }: {
  orgId: string; role: string | null; payload?: WidgetPayload;
}) {
  const titleId = useId();
  const actions = useDashboardActions();
  const articleRef = useRef<HTMLElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const items = homeTasks(payload);
  const known = payload?.status === "live" || payload?.status === "empty";
  const canWrite = Boolean(actions && role && role !== "viewer" && known);
  const href = `/todos?orgId=${encodeURIComponent(orgId)}`;
  const open = typeof payload?.data?.open === "number" ? payload.data.open : null;

  async function save(key: string, body: Record<string, unknown>) {
    if (busy || !actions) return;
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch("/api/todos", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json();
      if (!response.ok || data.status !== "live") throw new Error(data.error || "Could not save the task. Try again.");
      if (key === "create") setTitle("");
      setNotice(key === "create" ? "Task added." : "Task completed.");
      try { await actions.refresh("team_todos"); }
      catch { setNotice("Task saved. Open tasks to see the latest changes."); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the task. Try again.");
    } finally {
      setBusy(null);
      requestAnimationFrame(() => {
        const article = articleRef.current;
        if (!article || (document.activeElement !== document.body && !article.contains(document.activeElement))) return;
        const target = key === "create" ? 'input[aria-label="New team task"]' : 'input[type="checkbox"]:not(:disabled), header a';
        article.querySelector<HTMLElement>(target)?.focus();
      });
    }
  }

  return <article ref={articleRef} className="dash-home-tasks dash-widget app-card" aria-labelledby={titleId} data-testid="home-tasks" aria-busy={busy !== null}>
    <header><div><h2 id={titleId}>Team tasks</h2><p>{known ? open !== null && open > 0 ? `${open} open · yours first` : "A clear place for your team’s next steps" : "Tasks unavailable"}</p></div><a href={href}>All tasks <Icon name="chevron" /></a></header>
    {items.length ? <ul className="dash-home-task-list">{items.map(item => <li key={item.id}>
      {canWrite ? <label className="dash-home-task-check"><input type="checkbox" checked={busy === item.id} disabled={busy !== null}
        aria-label={`Complete ${item.title}`} onChange={() => void save(item.id, { action: "update-todo", todoId: item.id, status: "done" })} /><span aria-hidden="true" /></label> : null}
      <a href={`${href}&todoId=${encodeURIComponent(item.id)}`}><strong>{item.title}</strong><small>
        {item.assigneeName || "Unassigned"}{item.status === "doing" ? " · In progress" : ""}
        {item.dueOn ? <span className={item.overdue ? "is-overdue" : undefined}> · {item.overdue ? "Overdue · " : "Due "}{new Date(`${item.dueOn}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> : null}
      </small></a>
    </li>)}</ul> : <p className="dash-home-task-empty">{known ? "No open tasks. Add the next thing your team needs to do." : "Open tasks to try again."}</p>}
    {canWrite ? <form className="dash-home-task-add" onSubmit={event => {
      event.preventDefault(); if (title.trim()) void save("create", { action: "create-todo", title: title.trim() });
    }}><input aria-label="New team task" placeholder="Add a team task…" maxLength={200} value={title} disabled={busy !== null} onChange={event => setTitle(event.target.value)} />
      <Button type="submit" variant="primary" disabled={busy !== null || !title.trim()} aria-label="Add task"><span aria-hidden="true">＋</span></Button>
    </form> : null}
    {error ? <p className="dash-home-task-feedback" role="alert">{error}</p> : null}
    <p className="dash-home-task-feedback" role="status">{busy ? "Saving…" : notice}</p>
  </article>;
}
