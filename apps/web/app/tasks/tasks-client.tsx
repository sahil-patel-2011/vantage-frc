"use client";

import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../lib/offline";

import { OfflineBanner } from "../../components/offline-banner";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { priorityLabel, statusLabel } from "../../lib/tasks";
import {
  SUBSYSTEM_SUGGESTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TasksView,
} from "../../lib/tasks/compute-tasks";
import type { TaskPriority, TaskWithFlags } from "../../lib/tasks/types";

type LiveView = Extract<TasksView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function priorityTone(priority: TaskPriority): string {
  if (priority === "critical" || priority === "high") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function dueLabel(task: TaskWithFlags): { text: string; tone: string } | null {
  if (!task.dueOn || task.flags.daysToDue == null) return null;
  const d = task.flags.daysToDue;
  if (task.flags.overdue) return { text: `Overdue ${Math.abs(d)}d`, tone: "#c02626" };
  if (task.flags.dueSoon) return { text: d === 0 ? "Due today" : `Due ${d}d`, tone: "#b26a00" };
  return { text: `Due ${task.dueOn}`, tone: "inherit" };
}

export default function TasksClient() {
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [view, setView] = useState<TasksView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/tasks${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TasksView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      if (!navigator.onLine) {
        setError("You're offline — changes will save when you reconnect.");
        return;
      }
      setBusy(true);
      setError("");
      void fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as TasksView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Todos"
        title="Todos"
        description={
          <>
            Plan and track build-season work by subsystem — priorities, owners, due dates, and progress. A focused
            &quot;do next&quot; list surfaces the highest-leverage open tasks.
          </>
        }
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="todos" />
      <OfflineBanner feature="Todos" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the task board"
          description="A network or server issue prevented loading. Try again."
        >
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
          <MeetingOutput view={view} />
          <NormsBenchmark view={view} busy={busy} mutate={mutate} />
          <AvailableNow view={view} />
          {view.board.focus.length > 0 ? <FocusList view={view} /> : null}
          <CreateTaskForm view={view} busy={busy} mutate={mutate} />
          <Board view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function MeetingOutput({view}:{view:LiveView}){const o=view.meetingOutput;return <Panel><h2 style={{marginTop:0}}>Meeting time vs. output</h2><p className="app-muted">Planning visibility—not a student score. Week of {o.weekStart}.</p><div style={{display:"flex",gap:24,flexWrap:"wrap"}}><span><strong>{o.loggedHours}</strong> hours</span><span><strong>{o.tasksCompleted}</strong> tasks completed</span><span><strong>{o.hoursPerCompletedTask??"—"}</strong> hours/completion</span></div></Panel>}
function NormsBenchmark({view,busy,mutate}:{view:LiveView;busy:boolean;mutate:Mutate}){const b=view.benchmark;return <Panel><h2 style={{marginTop:0}}>Anonymous team norms</h2><p className="app-muted">{b.optedIn?(b.medianWeeklyHours==null?"Opted in; the median appears after five teams contribute.":`${b.medianWeeklyHours} hours/week median across ${b.teamCount} teams.`):"Disabled by default; no data contributes until an owner opts in."}</p>{view.canManage?<button type="button" className="app-button secondary" disabled={busy} onClick={()=>mutate({action:"set-benchmark-opt-in",optedIn:!b.optedIn})}>{b.optedIn?"Leave benchmark":"Opt in anonymously"}</button>:null}</Panel>}
function AvailableNow({view}:{view:LiveView}){const available=view.memberWorkload.filter((member)=>member.availableNow);return <Panel><h2 style={{marginTop:0}}>Who has nothing to do right now?</h2><p className="app-muted">Based on open collaborative assignments.</p><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{available.length?available.map((member)=><span key={member.userId} className="app-badge demo">{member.name} · available</span>):<span className="app-muted">Everyone has open work.</span>}</div></Panel>}

function MetricsTiles({ view }: { view: LiveView }) {
  const m = view.board.metrics;
  const tiles = [
    { label: "Open", value: String(m.open) },
    { label: "In progress", value: String(m.inProgress) },
    { label: "Blocked", value: String(m.blocked) },
    { label: "Overdue", value: String(m.overdue) },
    { label: "Done", value: String(m.done) },
    { label: "Complete", value: pct(m.completionPct) },
    { label: "Open est. hrs", value: String(m.estimatedOpenHours) },
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
      {m.bySubsystem.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {m.bySubsystem.map((row) => (
            <span key={row.subsystem} className="app-badge demo" title={`${row.done}/${row.total} done`}>
              {row.subsystem}: {row.open} open
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function FocusList({ view }: { view: LiveView }) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Do next</h2>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.board.focus.map((task) => {
          const due = dueLabel(task);
          return (
            <li key={task.id}>
              <strong>{task.title}</strong>{" "}
              <span className="app-muted">
                · {priorityLabel(task.priority)} · {task.subsystem}
                {task.assignee ? ` · ${task.assignee}` : " · unassigned"}
              </span>
              {due ? (
                <span style={{ color: due.tone, marginLeft: 6 }}>· {due.text}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function CreateTaskForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ title: "", subsystem: "", priority: "normal" as TaskPriority, assignee: "", estimateHours: "", dueOn: "" }),
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
          action: "create-task",
          title: form.title,
          subsystem: form.subsystem || undefined,
          priority: form.priority,
          assignees: form.assignee || undefined,
          estimateHours: form.estimateHours || undefined,
          dueOn: form.dueOn || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add task</h2>
      <FormGrid min={150}>
        <FormRow label="Title" wide>
          <input value={form.title} onChange={set("title")} placeholder="Mount the intake rollers" required />
        </FormRow>
        <FormRow label="Subsystem">
          <input value={form.subsystem} onChange={set("subsystem")} list="subsystem-options" placeholder="general" />
          <datalist id="subsystem-options">
            {SUBSYSTEM_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </FormRow>
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Collaborators" hint="Comma-separated">
          <input value={form.assignee} onChange={set("assignee")} placeholder="Avery, Jordan, Sam" />
        </FormRow>
        <FormRow label="Est. hours">
          <input type="number" min={0} step="0.5" value={form.estimateHours} onChange={set("estimateHours")} />
        </FormRow>
        <FormRow label="Due">
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add task
        </button>
      </div>
    </Panel>
  );
}

function Board({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.board.metrics.total === 0) {
    return (
      <EmptyState
        badge="Empty board"
        badgeTone="setup"
        title="No tasks yet"
        description="Add your first build task above to start the board."
      />
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, alignItems: "start" }}>
      {view.board.columns.map((column) => (
        <Panel key={column.status} style={{ display: "grid", gap: 10 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{column.label}</h2>
            <span className="app-badge demo">{column.count}</span>
          </header>
          {column.tasks.length === 0 ? (
            <p className="app-muted" style={{ margin: 0 }}>—</p>
          ) : (
            column.tasks.map((task) => <TaskCard key={task.id} task={task} busy={busy} mutate={mutate} />)
          )}
        </Panel>
      ))}
    </div>
  );
}

function TaskCard({ task, busy, mutate }: { task: TaskWithFlags; busy: boolean; mutate: Mutate }) {
  const due = dueLabel(task);
  return (
    <article
      style={{
        border: "1px solid var(--hairline, rgba(0,0,0,0.1))",
        borderRadius: 10,
        padding: 10,
        display: "grid",
        gap: 6,
        background: "var(--surface, transparent)",
      }}
    >
      <strong>{task.title}</strong>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className={`app-badge ${priorityTone(task.priority)}`}>{priorityLabel(task.priority)}</span>
        <small className="app-muted">{task.subsystem}</small>
        {task.estimateHours != null ? <small className="app-muted">· {task.estimateHours}h</small> : null}
      </div>
      {due ? <small style={{ color: due.tone }}>{due.text}</small> : null}
      {task.status === "blocked" && task.blockedReason ? (
        <small style={{ color: "#c02626" }}>Blocked: {task.blockedReason}</small>
      ) : null}
      <input
        defaultValue={(task.assignees??(task.assignee?[task.assignee]:[])).join(", ")}
        placeholder="Collaborators (comma-separated)"
        disabled={busy}
        aria-label="Owner"
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        onBlur={(event) => {
          const next = event.target.value.trim();
          const previous=(task.assignees??(task.assignee?[task.assignee]:[])).join(", ");
          if (next !== previous) {
            mutate({ action: "update-task", taskId: task.id, assignees: next });
          }
        }}
        style={{ fontSize: "0.85rem", padding: "4px 6px" }}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={task.status}
          disabled={busy}
          aria-label="Status"
          onChange={(event) => mutate({ action: "set-status", taskId: task.id, status: event.target.value })}
          style={{ fontSize: "0.8rem" }}
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <select
          value={task.priority}
          disabled={busy}
          aria-label="Priority"
          onChange={(event) => mutate({ action: "update-task", taskId: task.id, priority: event.target.value })}
          style={{ fontSize: "0.8rem" }}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${task.title}"?`)) mutate({ action: "delete-task", taskId: task.id });
          }}
          style={{ marginLeft: "auto", fontSize: "0.8rem" }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
