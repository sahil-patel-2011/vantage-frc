"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { BUILD_TASK_CATEGORIES, buildTaskCategoryLabel, buildTaskStatusLabel } from "../../lib/build-burndown";
import { type BuildBurndownView } from "../../lib/build-burndown/compute-build-burndown";
import {
  BUILD_BURNDOWN_RELATED_INCLUDE,
  buildBurndownNextActions,
  buildBurndownRelatedLinks,
  buildBurndownSetupSteps,
  buildBurndownShellCopy,
  classifyBuildBurndownShell,
  formatBuildBurndownMetric,
  formatBuildBurndownPercent,
  shouldShowBuildBurndownSummaryTiles,
  type BuildBurndownNextAction,
  type BuildBurndownShellKind,
} from "../../lib/build-burndown/build-burndown-related";
import type { BuildTaskCategory, BuildTaskStatus } from "../../lib/build-burndown/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./build-burndown.css";

function paceLabel(paceSignal: number): { text: string; tone: string } {
  if (paceSignal > 0.05) return { text: `Ahead of plan (${formatBuildBurndownPercent(paceSignal, true)})`, tone: "good" };
  if (paceSignal < -0.05) {
    return { text: `Behind plan (${formatBuildBurndownPercent(Math.abs(paceSignal), true)})`, tone: "danger" };
  }
  return { text: "On plan", tone: "setup" };
}

type LiveView = Extract<BuildBurndownView, { status: "live" }>;

function BurndownRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = buildBurndownRelatedLinks(orgId, {
    include: [...BUILD_BURNDOWN_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related build-burndown-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function BurndownNextActionsPanel({ actions }: { actions: BuildBurndownNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions build-burndown-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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

function BurndownShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: BuildBurndownShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = buildBurndownNextActions({ orgId, shell });
  const copy = buildBurndownShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "build-burndown", orgId);
  const steps = shell === "setup" ? buildBurndownSetupSteps(orgId) : [];

  return (
    <main className="module-page build-burndown-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Build Burndown"}
          </>
        }
        title="Build-Season Burndown"
        description={description}
      >
        <BurndownRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No tasks yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#build-burndown-plan">
              Set kickoff plan
            </a>
            <a className="app-button secondary" href={hubHref("/build", "kickoff", orgId)}>
              Open Kickoff
            </a>
            <a className="app-button secondary" href={hubHref("/team", "task-board", orgId)}>
              Open Task board
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="build-burndown-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="build-burndown-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted build-burndown-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <BurndownNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function BuildBurndownClient() {
  const [view, setView] = useState<BuildBurndownView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/build-burndown${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BuildBurndownView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const taskCount = view?.status === "live" ? view.tasks.length : 0;
  const hasPlan = view?.status === "live" ? Boolean(view.plan) : false;
  const remainingTasks = view?.status === "live" ? view.summary.remainingTasks : 0;

  const shell = classifyBuildBurndownShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    taskCount,
  });
  const shellCopy = buildBurndownShellCopy(shell);
  const nextActions = buildBurndownNextActions({
    orgId,
    shell,
    taskCount,
    hasPlan,
    remainingTasks,
  });
  const relatedLinks = buildBurndownRelatedLinks(orgId, {
    include: [...BUILD_BURNDOWN_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "build-burndown", orgId);
  const showTiles = shouldShowBuildBurndownSummaryTiles({ taskCount, hasPlan });

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/build-burndown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as BuildBurndownView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <BurndownShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <BurndownShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <BurndownShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <BurndownShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page build-burndown-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Build Burndown"}
          </>
        }
        title="Build-Season Burndown"
        description="Chart remaining build tasks against the kickoff-plan timeline. Readiness uses only what you record. Cross-check Task board, Kickoff, and FMEA."
      >
        <div className="build-burndown-header-actions">
          {view.seasons.length > 0 ? (
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
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <BurndownNextActionsPanel actions={nextActions} />

      {showTiles ? <SummaryTiles view={view} /> : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No tasks yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <a className="app-button" href={hasPlan ? "#build-burndown-tasks" : "#build-burndown-plan"}>
            {hasPlan ? "Add a build task" : "Set kickoff plan"}
          </a>
          <a className="app-button secondary" href={hubHref("/build", "kickoff", orgId)}>
            Open Kickoff
          </a>
          <a className="app-button secondary" href={hubHref("/team", "task-board", orgId)}>
            Open Task board
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {!view.plan ? <PlanForm busy={busy} mutate={mutate} /> : <BurndownChart view={view} />}
        <TaskForm busy={busy} mutate={mutate} />
        <TaskList view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const pace = paceLabel(summary.paceSignal);
  return (
    <Panel className="build-burndown-panel" aria-label="Build burndown counts">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <span className={`app-badge ${pace.tone}`}>{pace.text}</span>
      </div>
      <div className="build-burndown-stats">
        <div>
          <strong>{formatBuildBurndownMetric(summary.totalTasks, true)}</strong>
          <span className="app-muted">Total tasks</span>
        </div>
        <div>
          <strong>{formatBuildBurndownMetric(summary.completedTasks, true)}</strong>
          <span className="app-muted">Completed</span>
        </div>
        <div>
          <strong>{formatBuildBurndownMetric(summary.remainingTasks, true)}</strong>
          <span className="app-muted">Remaining</span>
        </div>
        <div>
          <strong>{formatBuildBurndownMetric(summary.overdueTasks, true)}</strong>
          <span className="app-muted">Overdue</span>
        </div>
        <div>
          <strong>{formatBuildBurndownPercent(summary.percentComplete, true)}</strong>
          <span className="app-muted">Progress</span>
        </div>
      </div>
    </Panel>
  );
}

function BurndownChart({ view }: { view: LiveView }) {
  if (view.series.length === 0) {
    return (
      <EmptyState
        soft
        badge="No tasks yet"
        badgeTone="setup"
        title="Add build tasks to see the burndown line"
        description="Once tasks have planned dates, this chart compares remaining work against the kickoff plan."
      />
    );
  }
  const maxRemaining = Math.max(1, ...view.series.map((p) => Math.max(p.planned, p.actual ?? 0)));
  return (
    <Panel className="build-burndown-panel" aria-label="Burndown chart">
      <h2 style={{ marginTop: 0 }}>Remaining tasks vs. plan</h2>
      <p className="app-muted">Real planned and actual remaining counts only.</p>
      <div className="build-burndown-chart">
        {view.series
          .filter((_, index) => index % Math.max(1, Math.ceil(view.series.length / 30)) === 0)
          .map((point) => (
            <div key={point.date} className="build-burndown-chart-row">
              <small className="app-muted">{point.date}</small>
              <span className="mini-probability" aria-label={`Planned remaining ${point.planned}`}>
                <i style={{ width: `${(point.planned / maxRemaining) * 100}%`, background: "var(--app-accent, #6c8cff)" }} />
              </span>
              <span className="mini-probability" aria-label={`Actual remaining ${point.actual ?? "unknown"}`}>
                {point.actual != null ? (
                  <i style={{ width: `${(point.actual / maxRemaining) * 100}%` }} />
                ) : null}
              </span>
            </div>
          ))}
      </div>
      <p className="app-muted" style={{ marginTop: 8 }}>
        Left bar: ideal remaining count from the kickoff plan. Right bar: actual remaining tasks (through today).
      </p>
    </Panel>
  );
}

function PlanForm({ busy, mutate }: { busy: boolean; mutate: (payload: Record<string, unknown>) => void }) {
  const [kickoffDate, setKickoffDate] = useState("");
  const [competitionDate, setCompetitionDate] = useState("");
  return (
    <Panel
      as="form"
      id="build-burndown-plan"
      className="build-burndown-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!kickoffDate || !competitionDate) return;
        mutate({ action: "set-plan", kickoffDate, competitionDate });
      }}
    >
      <h2 style={{ margin: 0 }}>Set the kickoff plan</h2>
      <p className="app-muted">
        Enter the real build-season window so the burndown chart can draw the ideal plan line.
      </p>
      <FormGrid min={160}>
        <FormRow label="Kickoff date">
          <input type="date" value={kickoffDate} onChange={(e) => setKickoffDate(e.target.value)} required />
        </FormRow>
        <FormRow label="Competition date">
          <input type="date" value={competitionDate} onChange={(e) => setCompetitionDate(e.target.value)} required />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !kickoffDate || !competitionDate}>
          Save plan
        </button>
      </div>
    </Panel>
  );
}

function TaskForm({ busy, mutate }: { busy: boolean; mutate: (payload: Record<string, unknown>) => void }) {
  const empty = useMemo(
    () => ({
      title: "",
      plannedDate: "",
      category: "mechanical" as BuildTaskCategory,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      id="build-burndown-tasks"
      className="build-burndown-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.plannedDate) return;
        mutate({
          action: "create-task",
          title: form.title,
          plannedDate: form.plannedDate,
          category: form.category,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Add build task</h2>
      <p className="app-muted">Tasks with planned dates drive the burndown.</p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Machine chassis rails" required />
        </FormRow>
        <FormRow label="Planned date">
          <input type="date" value={form.plannedDate} onChange={set("plannedDate")} required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {BUILD_TASK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {buildTaskCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.plannedDate}>
          Add task
        </button>
      </div>
    </Panel>
  );
}

function TaskList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.tasks.length === 0) {
    return (
      <EmptyState
        soft
        badge="No tasks yet"
        badgeTone="setup"
        title="Add your first build task"
        description="Tasks with planned dates from the kickoff plan drive the burndown line."
      />
    );
  }
  const statuses: BuildTaskStatus[] = ["pending", "in_progress", "done", "blocked"];
  return (
    <Panel className="build-burndown-panel">
      <h2 style={{ marginTop: 0 }}>Build tasks</h2>
      <p className="app-muted">Logged task rows only.</p>
      <ul className="build-burndown-list">
        {view.tasks.map((task) => (
          <li key={task.id} className="build-burndown-row">
            <div>
              <strong>{task.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                Planned {task.plannedDate} · {buildTaskCategoryLabel(task.category)} · {buildTaskStatusLabel(task.status)}
                {task.completedOn ? ` · completed ${task.completedOn}` : ""}
              </small>
              {task.notes ? <small className="app-muted">{task.notes}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={task.status}
                disabled={busy}
                onChange={(event) => mutate({ action: "update-status", taskId: task.id, status: event.target.value })}
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {buildTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${task.title}"?`)) {
                    mutate({ action: "delete-task", taskId: task.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
