"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { AttachedLinkChips, AttachedLinksEditor } from "../../components/attached-links";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import type { AttachedLink } from "../../lib/planner/links";
import "../planner-links.css";
import { useOnline } from "../../lib/offline";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  TODO_LIST_FILTERS,
  TODO_STATUSES,
  filterTodos,
  statusLabel,
  type TodoListFilter,
  type TeamTodo,
  type TodoStatus,
  type TodosView,
} from "../../lib/todos";
import "./todos.css";

type LiveView = Extract<TodosView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function dueLabel(todo: TeamTodo): { text: string; tone: string } | null {
  if (!todo.dueOn || todo.flags.daysToDue == null) return null;
  const d = todo.flags.daysToDue;
  if (todo.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "#c02626" };
  if (todo.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "#b26a00" };
  return { text: `Due ${todo.dueOn}`, tone: "inherit" };
}

export default function TodosClient({ embedded = false }: { embedded?: boolean } = {}) {
  const online = useOnline();
  const [fromCache] = useState(false);
  const [cachedAt] = useState<string | null>(null);
  const [view, setView] = useState<TodosView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<TodoListFilter>("all");

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    setLoadErrorMessage("");
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
          setLoadErrorMessage("error" in data && data.error ? data.error : "");
          setErrorStatus(response.status);
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
      if (!navigator.onLine) {
        setError("You're offline — changes will save when you reconnect.");
        return;
      }
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

  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({ status: errorStatus, message: loadErrorMessage, online }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message:
            loadErrorMessage ||
            "A network or server issue prevented loading. Select a workspace and try again.",
        },
      )
    : null;

  return (
    <main className={`module-page todos-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <>
          <PageHeader
            breadcrumbs="Team / Todos"
            title="Team work"
            description={
              <>
                A shared sheet of things to do — owner, due date, and attached links. Build tasks and milestones stay
                in their boards; this list never invents DEMO rows.
              </>
            }
          />
        </>
      ) : null}
      <OfflineBanner feature="Todos" fromCache={fromCache} cachedAt={cachedAt} />

      {!online ? (
        <p className="telemetry-status" role="status">
          You&apos;re offline — browsing last loaded todos only.
        </p>
      ) : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          <div className="soft-btn-row">
            {failure.primary ? (
              <a className="app-button" href={failure.primary.href}>
                {failure.primary.label}
              </a>
            ) : null}
            {failure.showRetry ? (
              <button type="button" className="app-button secondary" onClick={() => load()}>
                Retry
              </button>
            ) : null}
            <a className="app-button secondary" href="/workspace">
              Choose workspace
            </a>
          </div>
        </EmptyState>
      ) : view == null ? (
        <EmptyState soft title="Loading…" description="Checking your workspace for real todos." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
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
          {embedded ? null : <MetricsTiles view={view} />}
          <CreateTodoForm view={view} busy={busy} mutate={mutate} />
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            mineOpen={view.metrics.mineOpen}
            overdue={view.metrics.overdue}
          />
          <Board view={view} filter={filter} setFilter={setFilter} busy={busy} mutate={mutate} />
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
      <div className="todos-metrics">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <p className="todos-filter-note">Counts reflect saved org todos only — zeros stay zero until work is added.</p>
    </Panel>
  );
}

function FilterBar({
  filter,
  setFilter,
  mineOpen,
  overdue,
}: {
  filter: TodoListFilter;
  setFilter: (value: TodoListFilter) => void;
  mineOpen: number;
  overdue: number;
}) {
  return (
    <div className="soft-chip-row" role="toolbar" aria-label="Filter todos">
      {TODO_LIST_FILTERS.map((option) => {
        let label = option.label;
        if (option.id === "mine") label = `Mine (${mineOpen})`;
        if (option.id === "overdue") label = `Overdue (${overdue})`;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CreateTodoForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ title: "", notes: "", assigneeUserId: "", subteamId: "", dueOn: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const [links, setLinks] = useState<AttachedLink[]>([]);
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
          links,
        });
        setForm(empty);
        setLinks([]);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <FormGrid min={150}>
        <FormRow label="Title" wide>
          <input value={form.title} onChange={set("title")} placeholder="New reminder" required />
        </FormRow>
      </FormGrid>
      <details>
        <summary className="todos-more">More</summary>
        <FormGrid min={150}>
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
        <FormRow label="Links" wide>
          <AttachedLinksEditor links={links} onChange={setLinks} disabled={busy} addLabel="Attach link" />
        </FormRow>
        </FormGrid>
      </details>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add
        </button>
      </div>
    </Panel>
  );
}

function Board({
  view,
  filter,
  setFilter,
  busy,
  mutate,
}: {
  view: LiveView;
  filter: TodoListFilter;
  setFilter: (value: TodoListFilter) => void;
  busy: boolean;
  mutate: Mutate;
}) {
  const filtered = filterTodos(view.todos, filter, view.currentUserId);

  if (view.todos.length === 0) {
    return (
      <EmptyState
        soft
        badge="Empty"
        badgeTone="setup"
        title="No team todos yet"
        description="Add the first shared action item when your team has real work to track. Vantage does not invent DEMO task lists."
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        soft
        title="Nothing in this filter"
        description="Try All, or create a todo that matches this view. Filters never invent rows."
      >
        <button type="button" className="app-button secondary" onClick={() => setFilter("all")}>
          Show all
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="todos-sheet-wrap">
      <table className="todos-sheet">
        <thead>
          <tr>
            <th scope="col">Done</th>
            <th scope="col">What</th>
            <th scope="col">Who</th>
            <th scope="col">Due</th>
            <th scope="col">Links</th>
            <th scope="col"> </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((todo) => (
            <TodoSheetRow
              key={todo.id}
              todo={todo}
              view={view}
              busy={busy}
              mutate={mutate}
              focused={todo.id === view.focusTodoId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TodoSheetRow({
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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(todo.title);

  useEffect(() => {
    setTitle(todo.title);
  }, [todo.title]);

  return (
    <tr
      id={`todo-${todo.id}`}
      className={`${todo.status === "done" ? "is-done" : ""} ${focused ? "is-focused" : ""}`.trim()}
    >
      <td>
        <input
          type="checkbox"
          checked={todo.status === "done"}
          disabled={busy}
          aria-label={`Mark ${todo.title} done`}
          onChange={(event) =>
            mutate({
              action: "update-todo",
              todoId: todo.id,
              status: event.target.checked ? "done" : "todo",
            })
          }
        />
      </td>
      <td>
        <input
          className="todos-sheet-title"
          value={title}
          disabled={busy}
          aria-label="Title"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (!next || next === todo.title) {
              setTitle(todo.title);
              return;
            }
            mutate({ action: "update-todo", todoId: todo.id, title: next });
          }}
        />
        {todo.notes ? <div className="app-muted">{todo.notes}</div> : null}
      </td>
      <td>
        <select
          value={todo.assigneeUserId ?? ""}
          disabled={busy}
          aria-label="Assignee"
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
      </td>
      <td>
        <input
          type="date"
          value={todo.dueOn ?? ""}
          disabled={busy}
          aria-label="Due date"
          onChange={(event) =>
            mutate({
              action: "update-todo",
              todoId: todo.id,
              dueOn: event.target.value || null,
            })
          }
        />
        {due ? (
          <div className="todos-sheet-due" style={{ color: due.tone }}>
            {due.text}
          </div>
        ) : null}
      </td>
      <td>
        <AttachedLinkChips links={todo.links ?? []} empty={<span className="app-muted">—</span>} />
        {open ? (
          <AttachedLinksEditor
            links={todo.links ?? []}
            disabled={busy}
            addLabel="Attach"
            onChange={(next) => mutate({ action: "update-todo", todoId: todo.id, links: next })}
          />
        ) : null}
      </td>
      <td>
        <div className="todos-sheet-actions">
          <button type="button" className="app-button secondary" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide" : "Links"}
          </button>
          <select
            value={todo.status}
            disabled={busy}
            aria-label="Status"
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
      </td>
    </tr>
  );
}
