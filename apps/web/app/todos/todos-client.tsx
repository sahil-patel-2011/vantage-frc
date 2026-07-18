"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { statusLabel } from "../../lib/todos";
import { TODO_STATUSES, type TodosView } from "../../lib/todos/compute-todos";
import type { TeamTodo, TodoStatus } from "../../lib/todos/types";

type LiveView = Extract<TodosView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function dueLabel(todo: TeamTodo): { text: string; tone: string } | null {
  if (!todo.dueOn || todo.flags.daysToDue == null) return null;
  const d = todo.flags.daysToDue;
  if (todo.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "#c02626" };
  if (todo.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "#b26a00" };
  return { text: `Due ${todo.dueOn}`, tone: "inherit" };
}

function withOrg(href: string, orgId: string | null) {
  if (!orgId) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

export default function TodosClient() {
  const [view, setView] = useState<TodosView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "mine" | TodoStatus>("all");

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const todoId = params.get("todoId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (todoId) query.set("todoId", todoId);
    void fetch(`/api/todos${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TodosView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (view?.status !== "live" || !view.focusTodoId) return;
    document.getElementById(`todo-${view.focusTodoId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [view]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as TodosView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Todos"
        title="Team todos"
        description={
          <>
            Shared goals and action items for the whole team — assignees, due dates, and optional calendar subteam
            tags. Empty until your org adds real work; nothing here is demo data.
          </>
        }
      >
        {view?.status === "live" ? (
          <a className="app-button secondary" href={withOrg("/tasks", orgId)}>
            Build board
          </a>
        ) : null}
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="todos" />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load team todos" description="A network or server issue prevented loading. Try again.">
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <MetricsTiles view={view} />
          <CreateTodoForm view={view} busy={busy} mutate={mutate} />
          <FilterBar filter={filter} setFilter={setFilter} mineOpen={view.metrics.mineOpen} />
          <Board view={view} filter={filter} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function MetricsTiles({ view }: { view: LiveView }) {
  const m = view.metrics;
  const tiles = [
    { label: "To do", value: String(m.todo) },
    { label: "Doing", value: String(m.doing) },
    { label: "Done", value: String(m.done) },
    { label: "Overdue", value: String(m.overdue) },
    { label: "Due soon", value: String(m.dueSoon) },
    { label: "Mine open", value: String(m.mineOpen) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.5rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FilterBar({
  filter,
  setFilter,
  mineOpen,
}: {
  filter: "all" | "mine" | TodoStatus;
  setFilter: (value: "all" | "mine" | TodoStatus) => void;
  mineOpen: number;
}) {
  const options: Array<{ id: "all" | "mine" | TodoStatus; label: string }> = [
    { id: "all", label: "All" },
    { id: "mine", label: `Mine (${mineOpen})` },
    { id: "todo", label: "To do" },
    { id: "doing", label: "Doing" },
    { id: "done", label: "Done" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={filter === option.id ? "app-button" : "app-button secondary"}
          onClick={() => setFilter(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CreateTodoForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ title: "", notes: "", assigneeUserId: "", subteamId: "", dueOn: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-todo",
          title: form.title,
          notes: form.notes || undefined,
          assigneeUserId: form.assigneeUserId || null,
          subteamId: form.subteamId || null,
          dueOn: form.dueOn || null,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add todo</h2>
      <FormGrid min={150}>
        <FormRow label="Title" wide>
          <input value={form.title} onChange={set("title")} placeholder="Finish sponsor thank-you emails" required />
        </FormRow>
        <FormRow label="Assignee">
          <select value={form.assigneeUserId} onChange={set("assigneeUserId")}>
            <option value="">Unassigned</option>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        {view.subteams.length > 0 ? (
          <FormRow label="Subteam">
            <select value={form.subteamId} onChange={set("subteamId")}>
              <option value="">Whole team</option>
              {view.subteams.map((subteam) => (
                <option key={subteam.id} value={subteam.id}>
                  {subteam.name}
                </option>
              ))}
            </select>
          </FormRow>
        ) : null}
        <FormRow label="Due">
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </FormRow>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={set("notes")} placeholder="Optional context" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add todo
        </button>
      </div>
    </Panel>
  );
}

function Board({
  view,
  filter,
  busy,
  mutate,
}: {
  view: LiveView;
  filter: "all" | "mine" | TodoStatus;
  busy: boolean;
  mutate: Mutate;
}) {
  const filtered = view.todos.filter((todo) => {
    if (filter === "all") return true;
    if (filter === "mine") return todo.assigneeUserId === view.currentUserId && todo.status !== "done";
    return todo.status === filter;
  });

  if (view.todos.length === 0) {
    return (
      <EmptyState
        title="No team todos yet"
        description="Add the first shared action item when your team has real work to track. Vantage does not invent demo todos."
      />
    );
  }

  if (filtered.length === 0) {
    return <EmptyState title="Nothing in this filter" description="Try All, or create a todo that matches this view." />;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {filtered.map((todo) => (
        <TodoCard
          key={todo.id}
          todo={todo}
          view={view}
          busy={busy}
          mutate={mutate}
          focused={todo.id === view.focusTodoId}
        />
      ))}
    </div>
  );
}

function TodoCard({
  todo,
  view,
  busy,
  mutate,
  focused,
}: {
  todo: TeamTodo;
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  focused: boolean;
}) {
  const due = dueLabel(todo);
  const deepLink = `/todos?orgId=${encodeURIComponent(view.orgId)}&todoId=${encodeURIComponent(todo.id)}`;

  return (
    <Panel
      id={`todo-${todo.id}`}
      style={{
        display: "grid",
        gap: 10,
        outline: focused ? "2px solid #1f4fd6" : undefined,
        outlineOffset: 2,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <strong style={{ fontSize: "1.05rem" }}>{todo.title}</strong>
          <div className="app-muted" style={{ marginTop: 4 }}>
            {todo.assigneeName ? todo.assigneeName : "Unassigned"}
            {todo.subteamName ? (
              <>
                {" · "}
                <span style={{ color: todo.subteamColor ?? "inherit" }}>{todo.subteamName}</span>
              </>
            ) : null}
            {due ? (
              <span style={{ color: due.tone }}>
                {" · "}
                {due.text}
              </span>
            ) : null}
          </div>
        </div>
        <a className="app-muted" href={deepLink} title="Deep link">
          Link
        </a>
      </div>

      {todo.notes ? <p style={{ margin: 0 }}>{todo.notes}</p> : null}

      <FormGrid min={140}>
        <FormRow label="Status">
          <select
            value={todo.status}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "update-todo", todoId: todo.id, status: event.target.value as TodoStatus })
            }
          >
            {TODO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Assignee">
          <select
            value={todo.assigneeUserId ?? ""}
            disabled={busy}
            onChange={(event) =>
              mutate({
                action: "update-todo",
                todoId: todo.id,
                assigneeUserId: event.target.value || null,
              })
            }
          >
            <option value="">Unassigned</option>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        {view.subteams.length > 0 ? (
          <FormRow label="Subteam">
            <select
              value={todo.subteamId ?? ""}
              disabled={busy}
              onChange={(event) =>
                mutate({
                  action: "update-todo",
                  todoId: todo.id,
                  subteamId: event.target.value || null,
                })
              }
            >
              <option value="">Whole team</option>
              {view.subteams.map((subteam) => (
                <option key={subteam.id} value={subteam.id}>
                  {subteam.name}
                </option>
              ))}
            </select>
          </FormRow>
        ) : null}
        <FormRow label="Due">
          <input
            type="date"
            value={todo.dueOn ?? ""}
            disabled={busy}
            onChange={(event) =>
              mutate({
                action: "update-todo",
                todoId: todo.id,
                dueOn: event.target.value || null,
              })
            }
          />
        </FormRow>
      </FormGrid>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {todo.status !== "doing" && todo.status !== "done" ? (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, status: "doing" })}
          >
            Start
          </button>
        ) : null}
        {todo.status !== "done" ? (
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, status: "done" })}
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, status: "todo" })}
          >
            Reopen
          </button>
        )}
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete “${todo.title}”?`)) {
              mutate({ action: "delete-todo", todoId: todo.id });
            }
          }}
        >
          Delete
        </button>
      </div>
    </Panel>
  );
}
