"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { TeamHubRelated } from "../../components/team-hub-related";
import { ViewOnlyNote } from "../../components/view-only-note";
import { useViewOnly } from "../../lib/nav/use-view-only";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile, Button, askConfirm } from "../../components/ui";
import { useOnline } from "../../lib/offline";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { getFeatureSnapshot, putFeatureSnapshot, syncOutbox } from "../../lib/offline";
import type { WorkItemsView } from "../../lib/work-items/service";
import {
  TODO_LIST_FILTERS,
  TODOS_RELATED_INCLUDE,
  TODO_STATUSES,
  TODO_TITLE_MAX,
  filterTodos,
  localDateIso,
  statusLabel,
  todoDeepLink,
  todosNextActions,
  type TodoListFilter,
  type TeamTodo,
  type TodoStatus,
  type TodosView,
} from "../../lib/todos";
import { persistTodo } from "../../lib/todos/persist";
import "./todos.css";

type LiveView = Extract<TodosView, { status: "live" }>;
type LiveWorkView = Extract<WorkItemsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => Promise<boolean>;

/** Tones are theme tokens: a fixed #c02626 was 2.65:1 on a dark card (A6-07). */
function dueLabel(todo: TeamTodo): { text: string; tone: string } | null {
  if (!todo.dueOn || todo.flags.daysToDue == null) return null;
  const d = todo.flags.daysToDue;
  if (todo.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "var(--critical)" };
  if (todo.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "var(--warning)" };
  return { text: `Due ${todo.dueOn}`, tone: "inherit" };
}

/** View-only members (parents, guests) can't complete a task, so they aren't offered as assignees. */
function assignableMembers(members: LiveView["members"], keepUserId?: string | null): LiveView["members"] {
  return members.filter((member) => member.role !== "viewer" || member.userId === keepUserId);
}

/** Shown once a title nears the limit, so nothing is cut off without warning (A5-01). */
function TitleCount({ id, length }: { id: string; length: number }) {
  if (length < TODO_TITLE_MAX - 40) return <span id={id} hidden />;
  return (
    <p id={id} className="todos-title-count" aria-live="polite">
      {length >= TODO_TITLE_MAX
        ? `That's the ${TODO_TITLE_MAX}-character limit. Put the rest in Notes under Details.`
        : `${TODO_TITLE_MAX - length} characters left in the title.`}
    </p>
  );
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
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
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
          <span className="app-badge">All trackers</span>
          <h2>Tasks, build tasks, and milestones</h2>
          <p className="app-muted">
            One read across the team&apos;s trackers. Open an item in its owning board to update it.
          </p>
        </div>
        <Button as="a" variant="secondary" href={withOrgHref("/tasks", view.orgId)}>
          Open task board
        </Button>
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
              <Button as="a" variant="secondary" href={withOrgHref(item.href, view.orgId)}>
                Open
              </Button>
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
  const Root = embedded ? "section" : "main";
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
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
  // View only (0715): the list, without the Add form.
  const viewOnly = useViewOnly(orgId);

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
    // "Due today" and "Overdue" follow this device's calendar, not the server's UTC date.
    query.set("today", localDateIso());
    void fetch(`/api/todos${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TodosView | { error?: string };
        if (!response.ok || !("status" in data)) {
          if (urlOrg) {
            const row = await getFeatureSnapshot<TodosView>("todos", urlOrg);
            if (row) {
              setView(row.data);
              setFromCache(true);
              setCachedAt(row.cachedAt);
              return;
            }
          }
          setLoadErrorMessage("error" in data && data.error ? data.error : "");
          setErrorStatus(response.status);
          setFetchFailed(true);
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(new Date().toISOString());
        const persistOrg = "orgId" in data && data.orgId ? data.orgId : urlOrg;
        if (persistOrg) await putFeatureSnapshot("todos", persistOrg, data);
      })
      .catch(async () => {
        if (urlOrg) {
          const row = await getFeatureSnapshot<TodosView>("todos", urlOrg);
          if (row) {
            setView(row.data);
            setFromCache(true);
            setCachedAt(row.cachedAt);
            return;
          }
        }
        setFetchFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadWork = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/work-items${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
    })
      .then(async (response) => (response.ok ? (await response.json()) as WorkItemsView : null))
      .then((data) => {
        setWorkView(data?.status === "live" ? data : null);
      })
      .catch(() => setWorkView(null));
  }, []);

  useEffect(() => { loadWork(); }, [loadWork]);

  useEffect(() => {
    if (view?.status !== "live" || !view.focusTodoId) return;
    document.getElementById(`todo-${view.focusTodoId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [view]);

  useEffect(() => {
    if (!orgId) return;
    const onOnline = () => {
      void syncOutbox({ orgId }).then(() => { load(); loadWork(); });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [orgId, load, loadWork]);

  const mutate = useCallback<Mutate>(
    async (payload) => {
      if (!orgId || busy) return false;
      setBusy(true);
      setError("");
      try {
        const result = await persistTodo(orgId, { ...payload, today: localDateIso() }, navigator.onLine);
        if (result.kind === "queued") {
          if (view?.status === "live" && payload.action === "update-todo" && typeof payload.todoId === "string") {
            setView({
              ...view,
              todos: view.todos.map((todo) =>
                todo.id === payload.todoId && typeof payload.status === "string"
                  ? { ...todo, status: payload.status as TodoStatus }
                  : todo,
              ),
            });
          }
          setError("Saved on this device. It will upload when you are back online.");
        } else {
          setView(result.view);
          loadWork();
        }
        return true;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not save the task. Check your connection and try again.");
        // A task someone else already deleted: refresh so the list stops showing it.
        if (failure instanceof Error && /already deleted|was deleted/.test(failure.message)) load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, view, loadWork, load],
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
            "A network or server issue prevented loading. Choose your team and try again.",
        },
      )
    : null;

  return (
    <Root className={`module-page todos-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <>
          <PageHeader
            breadcrumbs="Team"
            title="Tasks"
            description={
              <>
                Tasks, build tasks, and season milestones in one place. Add quick team tasks here and open
                specialized work in its owning board.
              </>
            }
          >
            {view?.status === "live" ? (
              <Button as="a" variant="secondary" href={withOrgHref("/tasks", orgId)}>
                Task board
              </Button>
            ) : null}
          </PageHeader>
          <TeamHubRelated
            orgId={orgId}
            active="todos"
            include={[...TODOS_RELATED_INCLUDE]}
            ariaLabel="Related team ops for todos"
          />
        </>
      ) : null}
      <OfflineBanner feature="Tasks" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState
          soft
          badge={failure.kind === "setup" ? "Needs setup" : undefined}
          badgeTone={failure.kind === "setup" ? "setup" : undefined}
          title={failure.title}
          description={failure.description}
        >
          <div className="soft-btn-row">
            {failure.primary ? (
              <Button as="a" variant="primary" href={failure.primary.href}>
                {failure.primary.label}
              </Button>
            ) : null}
            {failure.showRetry ? (
              <Button variant="secondary" type="button" onClick={() => load()}>
                Retry
              </Button>
            ) : null}
          </div>
        </EmptyState>
      ) : view == null ? (
        <EmptyState soft title="Loading…" description="Checking your team for real todos." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState soft badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : (
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          )}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Counts and the all-trackers summary wait for some work to count: an empty team saw
              ten zero tiles above the one field it needed. */}
          {embedded || view.todos.length === 0 ? null : <MetricsTiles view={view} />}
          {workView && workView.items.length > 0 ? <UnifiedWorkSummary view={workView} /> : null}
          {viewOnly ? <ViewOnlyNote /> : <CreateTodoForm view={view} busy={busy} mutate={mutate} />}
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            mineOpen={view.metrics.mineOpen}
            overdue={view.metrics.overdue}
          />
          <Board view={view} filter={filter} setFilter={setFilter} busy={busy} mutate={mutate} viewOnly={viewOnly} />
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
    </Root>
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
    <label className="todos-filter">
      <span>Show</span>
      <select aria-label="Show tasks" value={filter} onChange={(event) => setFilter(event.target.value as TodoListFilter)}>
      {TODO_LIST_FILTERS.map((option) => {
        let label = option.label;
        if (option.id === "mine") label = `Mine (${mineOpen})`;
        if (option.id === "overdue") label = `Overdue (${overdue})`;
        return (
          <option key={option.id} value={option.id}>{label}</option>
        );
      })}
      </select>
    </label>
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
      className="todos-create"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !form.title.trim()) return;
        const submitted = form;
        const saved = await mutate({
          action: "create-todo",
          title: form.title,
          notes: form.notes || undefined,
          assigneeUserId: form.assigneeUserId || null,
          subteamId: form.subteamId || null,
          dueOn: form.dueOn || null,
        });
        if (saved) setForm((current) => current === submitted ? empty : current);
      }}
    >
      <div className="todos-create-row">
        <FormRow label="Title" wide>
          <input
            value={form.title}
            onChange={set("title")}
            placeholder="Add a team task…"
            required
            maxLength={TODO_TITLE_MAX}
            aria-describedby="todo-title-count"
          />
        </FormRow>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>Add</Button>
      </div>
      <TitleCount id="todo-title-count" length={form.title.length} />
      <details>
        <summary className="todos-more">Details</summary>
        <FormGrid min={150}>
        <FormRow label="Assignee">
          <select value={form.assigneeUserId} onChange={set("assigneeUserId")}>
            <option value="">Unassigned</option>
            {assignableMembers(view.members).map((member) => (
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
    </Panel>
  );
}

function Board({
  view,
  filter,
  setFilter,
  busy,
  mutate,
  viewOnly = false,
}: {
  view: LiveView;
  filter: TodoListFilter;
  setFilter: (value: TodoListFilter) => void;
  busy: boolean;
  mutate: Mutate;
  /** A parent or guest: no Mark done, Reopen or edit controls that the database refuses anyway. */
  viewOnly?: boolean;
}) {
  const filtered = filterTodos(view.todos, filter, view.currentUserId);

  if (view.todos.length === 0) {
    return (
      <EmptyState
        soft
        badge="Empty"
        badgeTone="setup"
        title="No team tasks yet"
        description="Type the first one in the box above and press Add. A short title is enough; assign it and set a due date under Details."
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        soft
        title="Nothing in this filter"
        description="Show all, or add a todo that matches this view."
      >
        <Button variant="secondary" type="button" onClick={() => setFilter("all")}>
          Show all
        </Button>
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
          viewOnly={viewOnly}
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
  viewOnly = false,
}: {
  todo: TeamTodo;
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  focused: boolean;
  viewOnly?: boolean;
}) {
  const due = dueLabel(todo);
  const deepLink = todoDeepLink(view.orgId, todo.id);
  const me = view.members.find((member) => member.userId === view.currentUserId);
  const canDelete =
    me?.role === "owner" || me?.role === "admin" || todo.createdBy === view.currentUserId || todo.assigneeUserId === view.currentUserId;
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes ?? "");
  useEffect(() => {
    setTitle(todo.title);
    setNotes(todo.notes ?? "");
  }, [todo.title, todo.notes]);
  const textChanged = title.trim() !== todo.title || notes.trim() !== (todo.notes ?? "").trim();
  const shortTitle = todo.title.length > 60 ? `${todo.title.slice(0, 59)}…` : todo.title;

  return (
    <article className={focused ? "todos-card is-focused" : "todos-card"} id={`todo-${todo.id}`}>
      <div className="todos-card-head">
        <div>
          <strong>{todo.title}</strong>
          <div className="todos-card-meta">
            {statusLabel(todo.status)}{" · "}
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
      </div>

      {todo.notes ? <p style={{ margin: 0 }}>{todo.notes}</p> : null}

      {/* A parent or guest saw "Mark done" on every task, and the tap was refused (QA A3-18). */}
      {viewOnly ? null : (
      <div className="todos-card-controls">
        <details className="todos-card-details">
          <summary>Details</summary>
          {/* Fix a typo without deleting and re-adding the task (A5-22). */}
          <form
            className="todos-card-text"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim() || !textChanged) return;
              void mutate({ action: "update-todo", todoId: todo.id, title: title.trim(), notes: notes.trim() });
            }}
          >
            <FormRow label="Title" wide>
              <input value={title} maxLength={TODO_TITLE_MAX} required disabled={busy} onChange={(event) => setTitle(event.target.value)} />
            </FormRow>
            <FormRow label="Notes" wide>
              <input value={notes} disabled={busy} placeholder="Optional context" onChange={(event) => setNotes(event.target.value)} />
            </FormRow>
            {textChanged ? (
              <div className="todos-card-actions">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setTitle(todo.title);
                    setNotes(todo.notes ?? "");
                  }}
                >
                  Cancel
                </Button>
                <Button variant="secondary" type="submit" disabled={busy || !title.trim()}>
                  Save text
                </Button>
              </div>
            ) : null}
          </form>
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
                {assignableMembers(view.members, todo.assigneeUserId).map((member) => (
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
            <a className="app-muted" href={deepLink}>Link to task</a>
            {canDelete ? (
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await askConfirm({
                      title: `Delete “${shortTitle}”?`,
                      body: `It comes off the list for the whole team${todo.assigneeName ? `, including ${todo.assigneeName}` : ""}. This can't be undone; mark it done instead if the work happened.`,
                      confirmLabel: "Delete task",
                      tone: "destructive",
                    })
                  ) {
                    mutate({ action: "delete-todo", todoId: todo.id });
                  }
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </details>
        {/* Secondary: the page's one primary is Add, and every card used to carry its own. */}
        {todo.status !== "done" ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-todo", todoId: todo.id, status: "done" })}>
            Mark done
          </Button>
        ) : (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-todo", todoId: todo.id, status: "todo" })}>
            Reopen
          </Button>
        )}
      </div>
      )}
    </article>
  );
}
