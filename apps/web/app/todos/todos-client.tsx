"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { useOnline } from "../../lib/offline";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { priorityLabel, statusLabel as taskStatusLabel } from "../../lib/tasks";
import { SUBSYSTEM_SUGGESTIONS, TASK_PRIORITIES, TASK_STATUSES } from "../../lib/tasks/compute-tasks";
import type { TaskPriority, TaskStatus } from "../../lib/tasks/types";
import {
  TODO_LIST_FILTERS,
  TODOS_RELATED_INCLUDE,
  filterTodos,
  todoDeepLink,
  todosNextActions,
  type TodoListFilter,
  type TeamTodo,
  type TodosView,
} from "../../lib/todos";
import "./todos.css";

type LiveView = Extract<TodosView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;
type ViewMode = "list" | "board";

/** Board columns — archived tasks stay out of the columns but remain in the list under Done. */
const BOARD_COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

function dueLabel(todo: TeamTodo): { text: string; tone: string } | null {
  if (!todo.dueOn || todo.flags.daysToDue == null) return null;
  const d = todo.flags.daysToDue;
  if (todo.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "#c02626" };
  if (todo.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "#b26a00" };
  return { text: `Due ${todo.dueOn}`, tone: "inherit" };
}

function priorityTone(priority: TaskPriority): string {
  return priority === "critical" || priority === "high" ? "setup" : "demo";
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
        <p>From real team tasks only — never a DEMO task list.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
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
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "list";
    try {
      return window.localStorage.getItem("vantage.todos.view") === "board" ? "board" : "list";
    } catch {
      return "list";
    }
  });

  const orgId = view && "orgId" in view ? view.orgId : null;

  const switchMode = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem("vantage.todos.view", next);
    } catch {
      // Per-device convenience only.
    }
  }, []);

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

  const modeToggle = (
    <div className="soft-chip-row todos-mode" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={mode === "list"} aria-pressed={mode === "list"} onClick={() => switchMode("list")}>
        List
      </button>
      <button type="button" role="tab" aria-selected={mode === "board"} aria-pressed={mode === "board"} onClick={() => switchMode("board")}>
        Board
      </button>
    </div>
  );

  return (
    <main className={`module-page todos-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <>
          <PageHeader
            breadcrumbs="Team / Todos"
            title="Team todos"
            description={
              <>
                One shared task list for the team — quick reminders and build-season work live together, with
                assignees, due dates, priorities, and a board view by status. Empty until your team adds real work;
                never a DEMO task list.
              </>
            }
          >
            {view?.status === "live" ? modeToggle : null}
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
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
          <NextActions orgId={view.orgId} todoCount={0} mineOpen={0} overdue={0} />
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {embedded ? null : <MetricsTiles view={view} />}
          <CreateTodoForm view={view} busy={busy} mutate={mutate} />
          <div className="todos-toolbar">
            <FilterBar
              filter={filter}
              setFilter={setFilter}
              mineOpen={view.metrics.mineOpen}
              overdue={view.metrics.overdue}
            />
            {embedded ? modeToggle : null}
          </div>
          {mode === "board" ? (
            <Board view={view} filter={filter} busy={busy} mutate={mutate} />
          ) : (
            <TodoList view={view} filter={filter} setFilter={setFilter} busy={busy} mutate={mutate} />
          )}
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
  const blocked = view.todos.filter((todo) => todo.taskStatus === "blocked").length;
  const tiles = [
    { label: "To do", value: String(m.todo) },
    { label: "Doing", value: String(m.doing) },
    { label: "Blocked", value: String(blocked) },
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
      <p className="todos-filter-note">Counts reflect saved team tasks only — zeros stay zero until work is added.</p>
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
    () => ({
      title: "",
      notes: "",
      assigneeUserId: "",
      subteamId: "",
      dueOn: "",
      priority: "normal" as TaskPriority,
      subsystem: "",
      collaborators: "",
      estimateHours: "",
    }),
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
          assignees: form.assigneeUserId ? undefined : form.collaborators || undefined,
          subteamId: form.subteamId || null,
          dueOn: form.dueOn || null,
          priority: form.priority,
          subsystem: form.subsystem || undefined,
          estimateHours: form.estimateHours || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <FormGrid min={150}>
        <FormRow label="Title" wide>
          <input value={form.title} onChange={set("title")} placeholder="New task or reminder" required />
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
        {!form.assigneeUserId ? (
          <FormRow label="Collaborators" hint="Comma-separated names (for people not on the roster yet)">
            <input value={form.collaborators} onChange={set("collaborators")} placeholder="Avery, Jordan" />
          </FormRow>
        ) : null}
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
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabel(priority)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem">
          <input value={form.subsystem} onChange={set("subsystem")} list="todo-subsystem-options" placeholder="general" />
          <datalist id="todo-subsystem-options">
            {[...new Set([...view.subsystems, ...SUBSYSTEM_SUGGESTIONS])].map((subsystem) => (
              <option key={subsystem} value={subsystem} />
            ))}
          </datalist>
        </FormRow>
        <FormRow label="Est. hours">
          <input type="number" min={0} step="0.5" value={form.estimateHours} onChange={set("estimateHours")} />
        </FormRow>
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

function EmptyTodos({ view }: { view: LiveView }) {
  return (
    <EmptyState
      soft
      badge="Empty"
      badgeTone="setup"
      title="No team tasks yet"
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

function TodoList({
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

  if (view.todos.length === 0) return <EmptyTodos view={view} />;

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

/** Status columns (the former /tasks board), over the same rows as the list. */
function Board({ view, filter, busy, mutate }: { view: LiveView; filter: TodoListFilter; busy: boolean; mutate: Mutate }) {
  if (view.todos.length === 0) return <EmptyTodos view={view} />;
  // Status filters make no sense on a board of status columns; keep Mine/Overdue.
  const scoped = filter === "mine" || filter === "overdue" ? filterTodos(view.todos, filter, view.currentUserId) : view.todos;
  return (
    <div className="todos-board">
      {BOARD_COLUMNS.map((status) => {
        const column = scoped.filter((todo) => todo.taskStatus === status);
        return (
          <Panel key={status} className="todos-column">
            <header className="todos-column-head">
              <h2>{taskStatusLabel(status)}</h2>
              <span className="app-badge demo">{column.length}</span>
            </header>
            {column.length === 0 ? (
              <p className="app-muted" style={{ margin: 0 }}>
                —
              </p>
            ) : (
              column.map((todo) => <BoardCard key={todo.id} todo={todo} view={view} busy={busy} mutate={mutate} />)
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function StatusSelect({ todo, busy, mutate }: { todo: TeamTodo; busy: boolean; mutate: Mutate }) {
  return (
    <select
      value={todo.taskStatus}
      disabled={busy}
      aria-label="Status"
      onChange={(event) => {
        const next = event.target.value as TaskStatus;
        const blockedReason =
          next === "blocked" ? (window.prompt("What is blocking this?", todo.blockedReason ?? "") ?? "") : undefined;
        mutate({ action: "update-todo", todoId: todo.id, taskStatus: next, blockedReason });
      }}
    >
      {TASK_STATUSES.map((status) => (
        <option key={status} value={status}>
          {taskStatusLabel(status)}
        </option>
      ))}
    </select>
  );
}

function BoardCard({ todo, view, busy, mutate }: { todo: TeamTodo; view: LiveView; busy: boolean; mutate: Mutate }) {
  const due = dueLabel(todo);
  const collaborators = todo.assignees.filter((name) => name !== todo.assigneeName);
  return (
    <article className="todos-board-card" id={`todo-${todo.id}`}>
      <strong>{todo.title}</strong>
      <div className="todos-board-meta">
        <span className={`app-badge ${priorityTone(todo.priority)}`}>{priorityLabel(todo.priority)}</span>
        {todo.subsystem && todo.subsystem !== "general" ? <small className="app-muted">{todo.subsystem}</small> : null}
        {todo.estimateHours != null ? <small className="app-muted">· {todo.estimateHours}h</small> : null}
      </div>
      <small className="app-muted">
        {todo.assigneeName ?? "Unassigned"}
        {collaborators.length ? ` + ${collaborators.join(", ")}` : ""}
        {todo.subteamName ? ` · ${todo.subteamName}` : ""}
      </small>
      {due ? <small style={{ color: due.tone }}>{due.text}</small> : null}
      {todo.taskStatus === "blocked" && todo.blockedReason ? (
        <small style={{ color: "#c02626" }}>Blocked: {todo.blockedReason}</small>
      ) : null}
      <div className="todos-board-actions">
        <StatusSelect todo={todo} busy={busy} mutate={mutate} />
        <select
          value={todo.assigneeUserId ?? ""}
          disabled={busy}
          aria-label="Assignee"
          onChange={(event) => mutate({ action: "update-todo", todoId: todo.id, assigneeUserId: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {view.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </div>
    </article>
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
  const collaborators = todo.assignees.filter((name) => name !== todo.assigneeName);

  return (
    <article className={focused ? "todos-card is-focused" : "todos-card"} id={`todo-${todo.id}`}>
      <div className="todos-card-head">
        <div>
          <strong>{todo.title}</strong>
          <div className="todos-card-meta">
            <span className={`app-badge ${priorityTone(todo.priority)}`}>{priorityLabel(todo.priority)}</span>{" "}
            {todo.assigneeName ? todo.assigneeName : "Unassigned"}
            {collaborators.length ? ` + ${collaborators.join(", ")}` : ""}
            {todo.subteamName ? (
              <>
                {" · "}
                <span style={{ color: todo.subteamColor ?? "inherit" }}>{todo.subteamName}</span>
              </>
            ) : null}
            {todo.subsystem && todo.subsystem !== "general" ? ` · ${todo.subsystem}` : ""}
            {todo.estimateHours != null ? ` · ${todo.estimateHours}h` : ""}
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
      {todo.taskStatus === "blocked" && todo.blockedReason ? (
        <p style={{ margin: 0, color: "#c02626" }}>Blocked: {todo.blockedReason}</p>
      ) : null}

      <FormGrid min={140}>
        <FormRow label="Status">
          <StatusSelect todo={todo} busy={busy} mutate={mutate} />
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
        <FormRow label="Priority">
          <select
            value={todo.priority}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-todo", todoId: todo.id, priority: event.target.value })}
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabel(priority)}
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
        <FormRow label="Collaborators" hint="Comma-separated">
          <input
            key={todo.assignees.join("|")}
            defaultValue={todo.assignees.join(", ")}
            placeholder="Names"
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== todo.assignees.join(", ")) {
                mutate({ action: "update-todo", todoId: todo.id, assignees: next });
              }
            }}
          />
        </FormRow>
      </FormGrid>

      <div className="todos-card-actions">
        {todo.taskStatus !== "in_progress" && todo.taskStatus !== "done" ? (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, taskStatus: "in_progress" })}
          >
            Start
          </button>
        ) : null}
        {todo.taskStatus !== "done" && todo.taskStatus !== "archived" ? (
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, taskStatus: "done" })}
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "update-todo", todoId: todo.id, taskStatus: "todo" })}
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
