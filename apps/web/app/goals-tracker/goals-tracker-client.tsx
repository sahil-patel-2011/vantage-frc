"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { GOAL_CATEGORIES, GOAL_STATUSES, goalCategoryLabel, goalStatusLabel } from "../../lib/goals-tracker";
import type { GoalsTrackerView } from "../../lib/goals-tracker/compute-goals-tracker";
import type { GoalCategory, GoalStatus } from "../../lib/goals-tracker/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusTone(status: GoalStatus): string {
  if (status === "completed") return "good";
  if (status === "abandoned") return "demo";
  return "setup";
}

type LiveView = Extract<GoalsTrackerView, { status: "live" }>;

export default function GoalsTrackerClient() {
  const [view, setView] = useState<GoalsTrackerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/goals-tracker${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as GoalsTrackerView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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
        const response = await fetch("/api/goals-tracker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as GoalsTrackerView | { error?: string };
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

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadError,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message: loadError || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Season Goals"}
          </>
        }
        title="Season Goals"
        description="Set goals for the season and track progress from real check-ins your team logs — never a guessed number."
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

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <CreateGoalForm busy={busy} mutate={mutate} />
          {view.summary.totalGoals > 0 ? <GoalsList view={view} busy={busy} mutate={mutate} /> : <NoGoalsEmptyState />}
        </div>
      )}
    </main>
  );
}

function NoGoalsEmptyState() {
  return (
    <EmptyState
      badge="No goals yet"
      badgeTone="setup"
      title="Set your first season goal"
      description="Define a target, then log check-ins over the season to track real progress."
    />
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total goals", value: String(summary.totalGoals) },
    { label: "Active", value: String(summary.activeGoals) },
    { label: "Completed", value: String(summary.completedGoals) },
    { label: "Overdue", value: String(summary.overdueGoals) },
    { label: "Avg. progress", value: pct(summary.averageProgress) },
  ];
  return (
    <Panel>
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

function GoalsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Goals</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.goals.map((row) => (
          <li key={row.goal.id} className="app-card soft-panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${statusTone(row.goal.status)}`}>{goalStatusLabel(row.goal.status)}</span>
                {row.overdue ? <span className="app-badge demo">OVERDUE</span> : null}
                <h3 style={{ margin: "6px 0 0" }}>{row.goal.title}</h3>
                <small className="app-muted" style={{ display: "block" }}>
                  {goalCategoryLabel(row.goal.category)}
                  {row.goal.dueOn ? ` · due ${row.goal.dueOn}` : ""}
                  {row.goal.description ? ` · ${row.goal.description}` : ""}
                </small>
              </div>
              <strong style={{ fontSize: "1.4rem" }}>{pct(row.progress)}</strong>
            </div>
            <span className="mini-probability" aria-hidden="true" style={{ display: "block", marginTop: 8 }}>
              <i style={{ width: `${Math.max(2, row.progress * 100)}%` }} />
            </span>
            <small className="app-muted">
              {row.latestValue != null
                ? `Latest: ${row.latestValue} ${row.goal.metricUnit} (target ${row.goal.targetValue})`
                : `No check-ins yet (target ${row.goal.targetValue} ${row.goal.metricUnit})`}
              {row.lastCheckinOn ? ` · last check-in ${row.lastCheckinOn}` : ""}
              {row.onTrack === false ? " · behind pace" : row.onTrack === true ? " · on pace" : ""}
            </small>

            <details style={{ marginTop: 8 }}>
              <summary className="app-muted" style={{ cursor: "pointer" }}>
                {row.checkinCount} check-in(s)
              </summary>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
                {row.checkins.map((checkin) => (
                  <li key={checkin.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      {checkin.occurredOn}: {checkin.value} {row.goal.metricUnit}
                      {checkin.note ? ` — ${checkin.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>

            <CheckinForm busy={busy} goalId={row.goal.id} mutate={mutate} />

            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {GOAL_STATUSES.filter((s) => s !== row.goal.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => mutate({ action: "update-status", goalId: row.goal.id, status })}
                >
                  Mark {goalStatusLabel(status).toLowerCase()}
                </button>
              ))}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${row.goal.title}"?`)) {
                    mutate({ action: "delete-goal", goalId: row.goal.id });
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

function CheckinForm({
  busy,
  goalId,
  mutate,
}: {
  busy: boolean;
  goalId: string;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value === "" || !occurredOn) return;
        mutate({ action: "log-checkin", goalId, value: Number(value), occurredOn, note: note || undefined });
        setValue("");
        setOccurredOn("");
        setNote("");
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}
    >
      <FormRow label="Log check-in value">
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} required />
      </FormRow>
      <FormRow label="Date">
        <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
      </FormRow>
      <FormRow label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </FormRow>
      <button type="submit" className="app-button secondary" disabled={busy || value === "" || !occurredOn}>
        Check in
      </button>
    </form>
  );
}

function CreateGoalForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      description: "",
      category: "build" as GoalCategory,
      metricUnit: "percent",
      startValue: "0",
      targetValue: "100",
      dueOn: "",
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
          action: "create-goal",
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          metricUnit: form.metricUnit || "percent",
          startValue: Number(form.startValue) || 0,
          targetValue: Number(form.targetValue) || 100,
          dueOn: form.dueOn || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Set a goal</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Ship autonomous routine" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {GOAL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {goalCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric unit">
          <input value={form.metricUnit} onChange={set("metricUnit")} placeholder="percent, count, hours…" />
        </FormRow>
        <FormRow label="Start value">
          <input type="number" value={form.startValue} onChange={set("startValue")} />
        </FormRow>
        <FormRow label="Target value">
          <input type="number" value={form.targetValue} onChange={set("targetValue")} />
        </FormRow>
        <FormRow label="Due date (optional)">
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add goal
        </button>
      </div>
    </Panel>
  );
}
