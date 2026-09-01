"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { useOnline } from "../../lib/offline";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { WorkItemsView } from "../../lib/work-items/service";
import {
  TODO_LIST_FILTERS,
  TODOS_RELATED_INCLUDE,
  TODO_STATUSES,
  filterTodos,
  statusLabel,
  todoDeepLink,
  todosNextActions,
  type TodoListFilter,
  type TeamTodo,
  type TodoStatus,
  type TodosView,
} from "../../lib/todos";
import "./todos.css";

type LiveView = Extract<TodosView, { status: "live" }>;
type LiveWorkView = Extract<WorkItemsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function dueLabel(todo: TeamTodo): { text: string; tone: string } | null {
  if (!todo.dueOn || todo.flags.daysToDue == null) return null;
  const d = todo.flags.daysToDue;
  if (todo.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "#c02626" };
  if (todo.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "#b26a00" };
  return { text: `Due ${todo.dueOn}`, tone: "inherit" };
}

function NextActions({
  orgId,
  todoCount,
  mineOpen,
  overdue,
}: {
  orgId?: string | null;
  todoCount: number;
  mineOpen: number;
  overdue: number;
}) {
  const actions = todosNextActions({ orgId, todoCount, mineOpen, overdue });
  if (actions.length === 0) return null;
  return (
    <section className="todos-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>From real team_todos only — never a DEMO task list.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UnifiedWorkSummary({ view }: { view: LiveWorkView | null }) {
  if (!view) return null;
  const crossTrackerItems = view.items
    .filter((item) => item.source !== "todo" && item.flags.open)
    .slice(0, 8);

  return (
    <Panel className="todos-unified-work" aria-label="All team work">
      <header>
        <div>
          <span className="app-badge">One work view</span>
          <h2>Todos, build tasks, and milestones</h2>
          <p className="app-muted">
            One read across the team&apos;s trackers. Open an item in its owning board to update it.
          </p>
        </div>
        <a className="app-button secondary" href={withOrgHref("/tasks", view.orgId)}>
          Open build board
        </a>
      </header>
      <div className="todos-unified-metrics">
        <StatTile label="Open" value={view.summary.open} />
        <StatTile label="Overdue" value={view.summary.overdue} />
        <StatTile label="Blocked" value={view.summary.blocked} />
        <StatTile label="Unowned" value={view.summary.unowned} />
      </div>
      {crossTrackerItems.length ? (
        <ul className="todos-cross-tracker-list">
          {crossTrackerItems.map((item) => (
            <li key={`${item.source}:${item.id}`}>
              <div>
                <span>{item.source === "build_task" ? "Build task" : "Milestone"}</span>
                <strong>{item.title}</strong>
                <small>
                  {item.status.replace("_", " ")}
                  {item.dueOn ? ` · due ${item.dueOn}` : ""}
                  {item.owners.length ? ` · ${item.owners.map((owner) => owner.name).join(", ")}` : " · unowned"}
                </small>
              </div>
              <a className="app-button secondary" href={withOrgHref(item.href, view.orgId)}>
                Open
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted todos-unified-empty">
          No open build tasks or milestones. Team todos remain below.
        </p>
      )}
    </Panel>
  );
}

export default function TodosClient({ embedded = false }: { embedded?: boolean } = {}) {
  const online = useOnline();
  const [fromCache] = useState(false);
  const [cachedAt] = useState<string | null>(null);
  const [view, setView] = useState<TodosView | null>(null);
  const [workView, setWorkView] = useState<LiveWorkView | null>(null);
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
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/work-items${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
    })
      .then(async (response) => (response.ok ? (await response.json()) as WorkItemsView : null))
      .then((data) => {
        if (data?.status === "live") setWorkView(data);
      })
      .catch(() => undefined);
  }, []);

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
                Todos, build tasks, and season milestones in one workbench. Create quick team todos here and open
                specialized work in its owning board; never a DEMO task list.
              </>
            }
          >
            {view?.status === "live" ? (
              <a className="app-button secondary" href={withOrgHref("/tasks", orgId)}>
                Build-season board
              </a>
            ) : null}
          </PageHeader>
          <TeamOpsNav orgId={orgId} active="todos" />
          <TeamHubRelated
            orgId={orgId}
            active="todos"
            include={[...TODOS_RELATED_INCLUDE]}
            ariaLabel="Related team ops for todos"
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
          <NextActions orgId={orgId} todoCount={0} mineOpen={0} overdue={0} />
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
          <NextActions orgId={view.orgId} todoCount={0} mineOpen={0} overdue={0} />
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {embedded ? null : <MetricsTiles view={view} />}
          <UnifiedWorkSummary view={workView} />
          <CreateTodoForm view={view} busy={busy} mutate={mutate} />
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            mineOpen={view.metrics.mineOpen}
            overdue={view.metrics.overdue}
          />
          <Board view={view} filter={filter} setFilter={setFilter} busy={busy} mutate={mutate} />
          {view.todos.length === 0 || view.metrics.overdue > 0 || view.metrics.mineOpen > 0 ? (
            <NextActions
              orgId={view.orgId}
              todoCount={view.todos.length}
              mineOpen={view.metrics.mineOpen}
              overdue={view.metrics.overdue}
            />
          ) : null}
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
      >
        <div className="soft-btn-row">
          <a className="app-button secondary" href={withOrgHref("/team?tab=calendar", view.orgId)}>
            Calendar
          </a>
          <a className="app-button secondary" href={withOrgHref("/team?tab=messages", view.orgId)}>
            Messages
          </a>
          <a className="app-button secondary" href={withOrgHref("/team?tab=practice", view.orgId)}>
            Practice
          </a>
        </div>
      </EmptyState>
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
    <div className="todos-list">
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
  const deepLink = todoDeepLink(view.orgId, todo.id);

  return (
    <article className={focused ? "todos-card is-focused" : "todos-card"} id={`todo-${todo.id}`}>
      <div className="todos-card-head">
        <div>
          <strong>{todo.title}</strong>
          <div className="todos-card-meta">
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

      <div className="todos-card-actions">
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
    </article>
  );
}
