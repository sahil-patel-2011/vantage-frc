"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { HEAT_DIRECTIONS, directionLabel } from "../../lib/scouting-heat-signals";
import type { ScoutingHeatSignalsView } from "../../lib/scouting-heat-signals/compute-scouting-heat-signals";
import type { HeatDirection } from "../../lib/scouting-heat-signals/types";

function directionTone(direction: HeatDirection): string {
  if (direction === "up") return "good";
  if (direction === "down") return "demo";
  return "setup";
}

function directionArrow(direction: HeatDirection): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

type LiveView = Extract<ScoutingHeatSignalsView, { status: "live" }>;

export default function ScoutingHeatSignalsClient() {
  const [view, setView] = useState<ScoutingHeatSignalsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/scouting-heat-signals${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutingHeatSignalsView | { error?: string };
        if (!response.ok || !("status" in data)) {
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scouting-heat-signals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ScoutingHeatSignalsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scouting Heat Signals"}
          </>
        }
        title="Scouting Heat Signals"
        description="Highlight teams trending up or down from what scouts have actually observed — a quick read to inform pick strategy. Only teams with logged observations show up here."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Scouting Heat Signals"
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
          <LogEntryForm busy={busy} mutate={mutate} />
          <TeamHeatList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Teams tracked", value: String(summary.totalTeams) },
    { label: "Observations", value: String(summary.totalEntries) },
    { label: "Trending up", value: String(summary.risingTeams) },
    { label: "Trending down", value: String(summary.fallingTeams) },
    { label: "Steady", value: String(summary.steadyTeams) },
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

function TeamHeatList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.teams.length === 0) {
    return (
      <EmptyState
        badge="No observations yet"
        badgeTone="setup"
        title="Log your first heat signal"
        description="Record a team as trending up or down after a match to build the pick-strategy trend view."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Team heat signals</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.teams.map((team) => (
          <li key={team.teamKey} className="app-card soft-panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <span className={`app-badge ${directionTone(team.direction)}`}>
                  {directionArrow(team.direction)} {directionLabel(team.direction)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>
                  {team.teamNumber ?? team.teamKey} {team.nickname ? `— ${team.nickname}` : ""}
                </strong>
                <small className="app-muted">
                  {team.entryCount} observation(s) · last {team.lastObservedOn}
                  {team.metricDelta != null ? ` · metric delta ${team.metricDelta > 0 ? "+" : ""}${team.metricDelta}` : ""}
                </small>
              </div>
              <small className="app-muted" style={{ textAlign: "right" }}>
                {team.risingCount}↑ · {team.fallingCount}↓ · {team.steadyCount}→
              </small>
            </div>
            <ul style={{ listStyle: "none", padding: 0, marginTop: 8, display: "grid", gap: 4 }}>
              {team.recentEntries.map((entry) => (
                <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <small className="app-muted">
                    {entry.observedOn} · {directionArrow(entry.direction)} {directionLabel(entry.direction)}
                    {entry.metricValue != null ? ` · ${entry.metricValue}` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </small>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "delete-entry", entryId: entry.id })}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      teamNumber: "",
      observedOn: "",
      direction: "up" as HeatDirection,
      metricValue: "",
      matchKey: "",
      note: "",
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
        if (!form.teamNumber || !form.observedOn) return;
        mutate({
          action: "log-entry",
          teamNumber: Number(form.teamNumber),
          observedOn: form.observedOn,
          direction: form.direction,
          metricValue: form.metricValue === "" ? undefined : Number(form.metricValue),
          matchKey: form.matchKey || undefined,
          note: form.note || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a heat signal</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} required />
        </FormRow>
        <FormRow label="Observed on">
          <input type="date" value={form.observedOn} onChange={set("observedOn")} required />
        </FormRow>
        <FormRow label="Direction">
          <select value={form.direction} onChange={set("direction")}>
            {HEAT_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {directionLabel(direction)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric value (optional)">
          <input type="number" value={form.metricValue} onChange={set("metricValue")} />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026week1_qm12" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.note} onChange={set("note")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.teamNumber || !form.observedOn}>
          Log signal
        </button>
      </div>
    </Panel>
  );
}
