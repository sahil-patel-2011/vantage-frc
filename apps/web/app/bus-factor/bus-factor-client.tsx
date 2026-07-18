"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { busFactorAreaLabel } from "../../lib/bus-factor";
import { BUS_FACTOR_AREAS, DEFAULT_WINDOW_WEEKS, type BusFactorView } from "../../lib/bus-factor/compute-bus-factor";
import type { BusFactorArea, RiskLevel } from "../../lib/bus-factor/types";

function riskTone(level: RiskLevel): string {
  if (level === "high") return "demo";
  if (level === "watch") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<BusFactorView, { status: "live" }>;

export default function BusFactorClient() {
  const [view, setView] = useState<BusFactorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [windowWeeks, setWindowWeeks] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((weeksOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const weeksQuery = weeksOverride ?? (params.get("weeks") ? Number(params.get("weeks")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (weeksQuery) query.set("weeks", String(weeksQuery));
    void fetch(`/api/bus-factor${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BusFactorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
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
        const response = await fetch("/api/bus-factor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, windowWeeks: windowWeeks ?? undefined, ...payload }),
        });
        const data = (await response.json()) as BusFactorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, windowWeeks, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Bus-Factor & Burnout"}
          </>
        }
        title="Bus-Factor & Burnout Watch"
        description="Early-warning for single-point-of-human-failure and overload risk, built only from what the team logs — hours and task/knowledge concentration."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Window
              <select
                value={windowWeeks ?? view.windowWeeks}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setWindowWeeks(next);
                  load(next);
                }}
              >
                {[4, 6, 8, 12].map((weeks) => (
                  <option key={weeks} value={weeks}>
                    {weeks} weeks
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
          title="Could not load bus-factor risk"
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
          <RiskPanel view={view} />
          <SummaryTiles view={view} />
          <LogEntryForm view={view} busy={busy} mutate={mutate} />
          {view.summary.areaConcentration.length > 0 ? <ConcentrationBreakdown view={view} /> : null}
          {view.entries.length > 0 ? <RecentEntries view={view} busy={busy} mutate={mutate} /> : (
            <EmptyState
              badge="No entries yet"
              badgeTone="setup"
              title="Log your first weekly workload entry"
              description="Track hours, tasks owned, and 'only I know how to do this' counts per member and area to surface concentration and overload risk."
            />
          )}
        </div>
      )}
    </main>
  );
}

function RiskPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel aria-label="Bus-factor risk">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${riskTone(summary.riskLevel)}`}>{summary.riskLevel.toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Organizational risk signal</h2>
          <small className="app-muted">
            {summary.activeMembers} active member(s) logged over the last {view.windowWeeks} week(s)
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(summary.riskScore)}</strong>
      </header>
      {summary.flags.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Flags</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {summary.flags.slice(0, 10).map((flag) => (
              <li key={flag.id}>
                <span className={`app-badge ${riskTone(flag.level)}`} style={{ marginRight: 6 }}>
                  {flag.level}
                </span>
                {flag.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : summary.activeMembers > 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No concentration, overload, or sole-knowledge risks detected in this window.
        </p>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Weeks covered", value: String(summary.weeksCovered) },
    { label: "Active members", value: String(summary.activeMembers) },
    { label: "Total hours", value: String(summary.totalHours) },
    { label: "Mean hrs/member/wk", value: String(summary.meanWeeklyHoursPerMember) },
    { label: "Areas tracked", value: String(summary.areaConcentration.length) },
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

function ConcentrationBreakdown({ view }: { view: LiveView }) {
  const { summary } = view;
  const actualByUser = useMemo(
    () => new Map(view.actualBuildHours.map((row) => [row.userId, row.hours])),
    [view.actualBuildHours],
  );
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By area</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.areaConcentration.map((row) => (
            <li key={row.area} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{busFactorAreaLabel(row.area)}</span>
              <small className="app-muted">
                {row.contributors} contributor(s) · {row.totalHours}h · top {pct(row.topContributorShare)}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By member</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.memberWorkloads.map((row) => {
            const actual = actualByUser.get(row.memberUserId);
            return (
              <li key={row.memberUserId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{row.memberName}</span>
                <small className="app-muted">
                  {row.totalHours}h · {row.totalTasksOwned} task(s) · {row.overloadRatio}x avg
                  {actual != null ? ` · ${actual}h clocked` : ""}
                </small>
              </li>
            );
          })}
        </ul>
        {view.actualBuildHours.length > 0 ? (
          <small className="app-muted" style={{ display: "block", marginTop: 6 }}>
            &quot;Clocked&quot; hours are actual Build Hours over the same window, for comparison against self-reported workload.
          </small>
        ) : null}
      </div>
    </section>
  );
}

function RecentEntries({
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
      <h2 style={{ marginTop: 0 }}>Logged entries</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 30).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.memberName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.weekStart} · {busFactorAreaLabel(item.area)}
              </small>
              <small className="app-muted">
                {item.hoursLogged}h · {item.tasksOwned} task(s) owned
                {item.soleKnowledgeCount > 0 ? ` · ${item.soleKnowledgeCount} sole-knowledge task(s)` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete this entry for ${item.memberName}?`)) {
                  mutate({ action: "delete-entry", entryId: item.id });
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

function LogEntryForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      memberUserId: view.members[0]?.userId ?? "",
      area: "mechanical" as BusFactorArea,
      weekStart: "",
      hoursLogged: "",
      tasksOwned: "",
      soleKnowledgeCount: "",
    }),
    [view.members],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.members.length === 0) return null;

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.memberUserId || !form.weekStart) return;
        mutate({
          action: "log-entry",
          memberUserId: form.memberUserId,
          area: form.area,
          weekStart: form.weekStart,
          hoursLogged: Number(form.hoursLogged) || 0,
          tasksOwned: Number(form.tasksOwned) || 0,
          soleKnowledgeCount: Number(form.soleKnowledgeCount) || 0,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log weekly workload</h2>
      <FormGrid min={160}>
        <FormRow label="Member">
          <select value={form.memberUserId} onChange={set("memberUserId")} required>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Area">
          <select value={form.area} onChange={set("area")}>
            {BUS_FACTOR_AREAS.map((area) => (
              <option key={area} value={area}>
                {busFactorAreaLabel(area)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Week starting">
          <input type="date" value={form.weekStart} onChange={set("weekStart")} required />
        </FormRow>
        <FormRow label="Hours logged">
          <input type="number" min={0} step="0.5" value={form.hoursLogged} onChange={set("hoursLogged")} />
        </FormRow>
        <FormRow label="Tasks owned">
          <input type="number" min={0} value={form.tasksOwned} onChange={set("tasksOwned")} />
        </FormRow>
        <FormRow label="Sole-knowledge tasks" hint="Tasks only this person knows how to do">
          <input type="number" min={0} value={form.soleKnowledgeCount} onChange={set("soleKnowledgeCount")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.memberUserId || !form.weekStart}>
          Log entry
        </button>
      </div>
    </Panel>
  );
}
