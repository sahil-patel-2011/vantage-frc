"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { GOAL_CATEGORIES, GOAL_STATUSES, goalCategoryLabel, goalStatusLabel } from "../../lib/goals-tracker";
import type { GoalsTrackerView } from "../../lib/goals-tracker/compute-goals-tracker";
import type { GoalCategory, GoalStatus } from "../../lib/goals-tracker/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusTone(status: GoalStatus): string {
  if (status === "completed") return "good";
  if (status === "abandoned") return "demo";
  return "setup";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

type LiveView = Extract<GoalsTrackerView, { status: "live" }>;

function isGoalsTrackerView(value: unknown): value is GoalsTrackerView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function goalsTrackerCacheOrg(data: GoalsTrackerView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistGoalsTrackerSnapshot(
  orgHint: string,
  seasonHint: string,
  data: GoalsTrackerView,
): Promise<void> {
  const cacheOrg = goalsTrackerCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("goals-tracker", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("goals-tracker", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Goals already painted; IndexedDB is best-effort.
  }
}

function GoalsTrackerRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "standup-digest", orgId)}>
        Standup
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "meeting-autopilot", orgId)}>
        Meeting agenda
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "season-planning-workspace", orgId)}>
        Season plan
      </Button>
    </nav>
  );
}

function GoalsTrackerNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "goal",
      label: "Set a goal",
      detail: "Define a target, then log check-ins over the season to track real progress.",
      href: "#goals-tracker-new",
      primary: true,
    },
    {
      id: "standup",
      label: "Open Standup",
      detail: "Yesterday's hours and task movement compile into the morning digest.",
      href: hubHref("/team", "standup-digest", orgId),
      primary: false,
    },
    {
      id: "meeting",
      label: "Open Meeting agenda",
      detail: "Agenda and minutes attach to a calendar meeting.",
      href: hubHref("/team", "meeting-autopilot", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function GoalsTrackerClient() {
  const [view, setView] = useState<GoalsTrackerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<GoalsTrackerView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<GoalsTrackerView>(
        "goals-tracker",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isGoalsTrackerView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/goals-tracker${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isGoalsTrackerView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Goals. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistGoalsTrackerSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Goals. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isGoalsTrackerView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistGoalsTrackerSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const teamHref = orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={teamHref}>Team</a>
          {" / Goals"}
        </>
      }
      title="Goals"
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
              void load(next);
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
      <GoalsTrackerRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
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
        {header}
        <OfflineBanner feature="Goals" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Goals" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Goals" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <GoalsTrackerNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <CreateGoalForm busy={busy} mutate={mutate} />
        {view.summary.totalGoals > 0 ? <GoalsList view={view} busy={busy} mutate={mutate} /> : <NoGoalsEmptyState />}
      </div>
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
                <Button variant="secondary" key={status} type="button" disabled={busy} onClick={() => mutate({ action: "update-status", goalId: row.goal.id, status })}>
                  Mark {goalStatusLabel(status).toLowerCase()}
                </Button>
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
      <Button variant="secondary" type="submit" disabled={busy || value === "" || !occurredOn}>
        Check in
      </Button>
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
      id="goals-tracker-new"
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
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Add goal
        </Button>
      </div>
    </Panel>
  );
}
