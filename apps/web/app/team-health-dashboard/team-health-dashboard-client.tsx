"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { moraleLabel } from "../../lib/team-health-dashboard";
import type { TeamHealthDashboardView } from "../../lib/team-health-dashboard/compute-team-health-dashboard";
import type { TeamHealthTier } from "../../lib/team-health-dashboard/types";

function tierTone(tier: TeamHealthTier): string {
  if (tier === "thriving") return "good";
  if (tier === "steady") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const COMPONENT_LABEL: Record<string, string> = {
  attendance: "Attendance",
  taskFlow: "Task completion",
  engagement: "Engagement",
  morale: "Morale",
  cadence: "Check-in cadence",
};

type LiveView = Extract<TeamHealthDashboardView, { status: "live" }>;

export default function TeamHealthDashboardClient() {
  const [view, setView] = useState<TeamHealthDashboardView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/team-health-dashboard${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TeamHealthDashboardView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setErrorMessage("error" in data && data.error ? data.error : null);
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
        const response = await fetch("/api/team-health-dashboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as TeamHealthDashboardView | { error?: string };
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
            {" / Team Health Dashboard"}
          </>
        }
        title="Team Health Dashboard"
        description="A unified view of attendance, task throughput, and engagement — built from the pulses your team logs, not fabricated numbers."
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
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
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
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} />
          <LogPulseForm busy={busy} mutate={mutate} />
          {view.summary.totalPulses > 0 ? <TrendPanel view={view} /> : null}
          <RecentPulses view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const components = Object.entries(readiness.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Team health readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Team health signal</h2>
          <small className="app-muted">{readiness.pulsesLogged} pulse(s) logged</small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Pulses logged", value: String(summary.totalPulses) },
    { label: "Avg attendance", value: `${summary.avgAttendanceRate}%` },
    { label: "Avg engagement", value: `${summary.avgEngagementScore}%` },
    { label: "Avg morale", value: moraleLabel(summary.avgMoraleRating) },
    { label: "Tasks completed", value: String(summary.totalTasksCompleted) },
    { label: "Tasks open", value: String(summary.totalTasksOpen) },
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

function TrendPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section className="app-card soft-panel">
      <h2 style={{ marginTop: 0 }}>Trend by period</h2>
      <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {summary.trend.map((point) => (
          <li key={point.periodStart} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{point.periodLabel}</span>
            <small className="app-muted">
              {point.attendanceRate}% attend · {point.taskThroughput}% tasks done · {point.engagementScore}% engaged · health {point.healthScore}%
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentPulses({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalPulses === 0) {
    return (
      <EmptyState
        badge="No pulses yet"
        badgeTone="setup"
        title="Log your first team-health pulse"
        description="Track attendance, task throughput, and engagement each week to build a real trend."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent pulses</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.pulses.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.periodLabel}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.periodStart} · {item.attendanceRate}% attendance ({item.membersPresent}/{item.membersTotal}) ·{" "}
                {moraleLabel(item.moraleRating)} morale
              </small>
              <small className="app-muted">
                {item.tasksCompleted} completed · {item.tasksOpen} open · {item.tasksOverdue} overdue ·{" "}
                {item.engagementScore}% engagement
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.periodLabel}"?`)) {
                  mutate({ action: "delete-pulse", pulseId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogPulseForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      periodLabel: "",
      periodStart: "",
      attendanceRate: "",
      membersPresent: "",
      membersTotal: "",
      tasksCompleted: "",
      tasksOpen: "",
      tasksOverdue: "",
      engagementScore: "",
      moraleRating: "3",
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
        if (!form.periodLabel.trim() || !form.periodStart) return;
        mutate({
          action: "log-pulse",
          periodLabel: form.periodLabel,
          periodStart: form.periodStart,
          attendanceRate: Number(form.attendanceRate) || 0,
          membersPresent: Number(form.membersPresent) || 0,
          membersTotal: Number(form.membersTotal) || 0,
          tasksCompleted: Number(form.tasksCompleted) || 0,
          tasksOpen: Number(form.tasksOpen) || 0,
          tasksOverdue: Number(form.tasksOverdue) || 0,
          engagementScore: Number(form.engagementScore) || 0,
          moraleRating: Number(form.moraleRating) || 3,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a pulse</h2>
      <FormGrid min={160}>
        <FormRow label="Period label">
          <input value={form.periodLabel} onChange={set("periodLabel")} placeholder="Week 3" required />
        </FormRow>
        <FormRow label="Period start">
          <input type="date" value={form.periodStart} onChange={set("periodStart")} required />
        </FormRow>
        <FormRow label="Attendance rate (%)">
          <input type="number" min={0} max={100} value={form.attendanceRate} onChange={set("attendanceRate")} />
        </FormRow>
        <FormRow label="Members present">
          <input type="number" min={0} value={form.membersPresent} onChange={set("membersPresent")} />
        </FormRow>
        <FormRow label="Members total">
          <input type="number" min={0} value={form.membersTotal} onChange={set("membersTotal")} />
        </FormRow>
        <FormRow label="Tasks completed">
          <input type="number" min={0} value={form.tasksCompleted} onChange={set("tasksCompleted")} />
        </FormRow>
        <FormRow label="Tasks open">
          <input type="number" min={0} value={form.tasksOpen} onChange={set("tasksOpen")} />
        </FormRow>
        <FormRow label="Tasks overdue">
          <input type="number" min={0} value={form.tasksOverdue} onChange={set("tasksOverdue")} />
        </FormRow>
        <FormRow label="Engagement score (%)">
          <input type="number" min={0} max={100} value={form.engagementScore} onChange={set("engagementScore")} />
        </FormRow>
        <FormRow label="Morale (1-5)">
          <select value={form.moraleRating} onChange={set("moraleRating")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} · {moraleLabel(n)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.periodLabel.trim() || !form.periodStart}>
          Log pulse
        </button>
      </div>
    </Panel>
  );
}
