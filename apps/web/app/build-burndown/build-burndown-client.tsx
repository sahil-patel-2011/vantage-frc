"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { BUILD_TASK_CATEGORIES, buildTaskCategoryLabel, buildTaskStatusLabel } from "../../lib/build-burndown";
import { type BuildBurndownView } from "../../lib/build-burndown/compute-build-burndown";
import type { BuildTaskCategory, BuildTaskStatus } from "../../lib/build-burndown/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function paceLabel(paceSignal: number): { text: string; tone: string } {
  if (paceSignal > 0.05) return { text: `Ahead of plan (${pct(paceSignal)})`, tone: "good" };
  if (paceSignal < -0.05) return { text: `Behind plan (${pct(Math.abs(paceSignal))})`, tone: "demo" };
  return { text: "On plan", tone: "setup" };
}

type LiveView = Extract<BuildBurndownView, { status: "live" }>;

export default function BuildBurndownClient() {
  const [view, setView] = useState<BuildBurndownView | null>(null);
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Build Burndown"}
          </>
        }
        title="Build-Season Burndown"
        description="Chart remaining build tasks against the kickoff-plan timeline. Readiness uses only what you record."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Build Burndown"
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
          <SummaryTiles view={view} />
          {!view.plan ? <PlanForm busy={busy} mutate={mutate} /> : <BurndownChart view={view} />}
          <TaskForm busy={busy} mutate={mutate} />
          <TaskList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const pace = paceLabel(summary.paceSignal);
  const tiles = [
    { label: "Total tasks", value: String(summary.totalTasks) },
    { label: "Completed", value: String(summary.completedTasks) },
    { label: "Remaining", value: String(summary.remainingTasks) },
    { label: "Overdue", value: String(summary.overdueTasks) },
    { label: "Progress", value: pct(summary.percentComplete) },
  ];
  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <span className={`app-badge ${pace.tone}`}>{pace.text}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BurndownChart({ view }: { view: LiveView }) {
  if (view.series.length === 0) {
    return (
      <EmptyState
        badge="No tasks yet"
        badgeTone="setup"
        title="Add build tasks to see the burndown line"
        description="Once tasks have planned dates, this chart compares remaining work against the kickoff plan."
      />
    );
  }
  const maxRemaining = Math.max(1, ...view.series.map((p) => Math.max(p.planned, p.actual ?? 0)));
  return (
    <Panel aria-label="Burndown chart">
      <h2 style={{ marginTop: 0 }}>Remaining tasks vs. plan</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {view.series
          .filter((_, index) => index % Math.max(1, Math.ceil(view.series.length / 30)) === 0)
          .map((point) => (
            <div key={point.date} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 8, alignItems: "center" }}>
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
      onSubmit={(event) => {
        event.preventDefault();
        if (!kickoffDate || !competitionDate) return;
        mutate({ action: "set-plan", kickoffDate, competitionDate });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Set the kickoff plan</h2>
      <p className="app-muted">
        Enter the build-season window so the burndown chart can draw the ideal plan line.
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
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add build task</h2>
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
        badge="No tasks yet"
        badgeTone="setup"
        title="Add your first build task"
        description="Tasks with planned dates from the kickoff plan drive the burndown line."
      />
    );
  }
  const statuses: BuildTaskStatus[] = ["pending", "in_progress", "done", "blocked"];
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Build tasks</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.tasks.map((task) => (
          <li key={task.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
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
