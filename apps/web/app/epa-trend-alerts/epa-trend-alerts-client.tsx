"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { directionLabel, severityLabel } from "../../lib/epa-trend-alerts";
import type { EpaTrendAlertsView } from "../../lib/epa-trend-alerts/compute-epa-trend-alerts";

type LiveView = Extract<EpaTrendAlertsView, { status: "live" }>;

function severityTone(severity: string): string {
  return severity === "high" ? "demo" : "setup";
}

function pct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 1000) / 10}%`;
}

export default function EpaTrendAlertsClient() {
  const [view, setView] = useState<EpaTrendAlertsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teamNumber, setTeamNumber] = useState("");
  const [note, setNote] = useState("");

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/epa-trend-alerts${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
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
        const response = await fetch("/api/epa-trend-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as EpaTrendAlertsView | { error?: string };
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
            {" / EPA Trend Alerts"}
          </>
        }
        title="EPA Trend Alerts"
        description="Watch teams you might face and get flagged the moment their EPA moves meaningfully between events — no fabricated forecasts, just the reference numbers you already trust."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/competition?orgId=${encodeURIComponent(orgId)}`}>
            Competition hub
          </a>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load EPA trend alerts"
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
          <WatchTeamForm
            busy={busy}
            teamNumber={teamNumber}
            setTeamNumber={setTeamNumber}
            note={note}
            setNote={setNote}
            mutate={mutate}
          />
          <AlertsPanel view={view} busy={busy} mutate={mutate} />
          <WatchlistPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Watched teams", value: String(summary.watchlistCount) },
    { label: "Active alerts", value: String(summary.alertCount) },
    { label: "Rising", value: String(summary.risingCount) },
    { label: "Falling", value: String(summary.fallingCount) },
    { label: "High severity", value: String(summary.highSeverityCount) },
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

function WatchTeamForm({
  busy,
  teamNumber,
  setTeamNumber,
  note,
  setNote,
  mutate,
}: {
  busy: boolean;
  teamNumber: string;
  setTeamNumber: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number(teamNumber);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        mutate({ action: "watch-team", teamNumber: parsed, note: note || undefined });
        setTeamNumber("");
        setNote("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add a team to the watchlist</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input
            type="number"
            min={1}
            value={teamNumber}
            onChange={(event) => setTeamNumber(event.target.value)}
            placeholder="254"
            required
          />
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Likely alliance pick" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !teamNumber.trim()}>
          Add to watchlist
        </button>
      </div>
    </Panel>
  );
}

function AlertsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.alerts.length === 0) {
    return (
      <EmptyState
        badge="No alerts"
        badgeTone="good"
        title="No meaningful EPA swings right now"
        description="Alerts appear here once a watched team's EPA moves enough between two events to matter."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Trend alerts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.alerts.map((alert) => (
          <li
            key={alert.fingerprint}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${severityTone(alert.severity)}`}>{severityLabel(alert.severity)}</span>{" "}
              <strong>
                {alert.teamNumber ?? alert.teamKey}
                {alert.nickname ? ` — ${alert.nickname}` : ""}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {directionLabel(alert.direction)}: {alert.previousEpa} → {alert.latestEpa} EPA (
                {pct(alert.percentChange)}) between {alert.previousEventName ?? alert.previousEventKey} and{" "}
                {alert.latestEventName ?? alert.latestEventKey}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                mutate({ action: "dismiss-alert", teamKey: alert.teamKey, latestEventKey: alert.latestEventKey })
              }
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WatchlistPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.watchlist.length === 0) {
    return (
      <EmptyState
        badge="Empty"
        badgeTone="setup"
        title="No teams on your watchlist yet"
        description="Add teams by number above to start tracking their EPA trend between events."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Watchlist</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.watchlist.map((team) => (
          <li key={team.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                {team.teamNumber ?? team.teamKey}
                {team.nickname ? ` — ${team.nickname}` : ""}
              </strong>
              {team.note ? (
                <small className="app-muted" style={{ display: "block" }}>
                  {team.note}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "unwatch-team", watchlistId: team.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
