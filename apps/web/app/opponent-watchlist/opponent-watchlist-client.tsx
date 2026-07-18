"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import type { OpponentWatchlistView } from "../../lib/opponent-watchlist/compute-opponent-watchlist";
import type { WatchlistAlertType } from "../../lib/opponent-watchlist/types";

type LiveView = Extract<OpponentWatchlistView, { status: "live" }>;

const ALERT_TONE: Record<WatchlistAlertType, string> = {
  epa_up: "good",
  epa_down: "demo",
  schedule_new: "setup",
  schedule_changed: "setup",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OpponentWatchlistClient() {
  const [view, setView] = useState<OpponentWatchlistView | null>(null);
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
    void fetch(`/api/opponent-watchlist${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as OpponentWatchlistView | { error?: string };
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
        const response = await fetch("/api/opponent-watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as OpponentWatchlistView | { error?: string };
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
            {" / Opponent Watchlist"}
          </>
        }
        title="Opponent Watchlist"
        description="Track opponent teams personally and get notified when their EPA or next scheduled match changes."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Opponent Watchlist"
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
          <AddEntryForm busy={busy} mutate={mutate} />
          <AlertsPanel view={view} />
          <WatchedTeams view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const tiles = [
    { label: "Watched teams", value: String(view.summary.totalWatched) },
    { label: "EPA alerts", value: String(view.summary.epaAlerts) },
    { label: "Schedule alerts", value: String(view.summary.scheduleAlerts) },
    { label: "Upcoming matches", value: String(view.summary.upcomingMatches) },
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

function AlertsPanel({ view }: { view: LiveView }) {
  if (view.alerts.length === 0) {
    return (
      <EmptyState
        badge="No changes"
        badgeTone="good"
        title="No EPA or schedule changes yet"
        description="Alerts appear here once a watched team's EPA moves or their next match is scheduled or rescheduled."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Alerts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.alerts.map((alert, index) => (
          <li key={`${alert.entryId}-${alert.type}-${index}`}>
            <span className={`app-badge ${ALERT_TONE[alert.type]}`}>{alert.type.replace("_", " ")}</span>
            <span style={{ marginLeft: 8 }}>{alert.message}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WatchedTeams({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="Empty watchlist"
        badgeTone="setup"
        title="Add your first opponent to watch"
        description="Track a team's EPA and upcoming schedule ahead of an event or alliance selection."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Watched teams</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.map((entry) => (
          <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                #{entry.teamNumber ?? "?"} {entry.nickname ?? entry.teamKey}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {entry.current
                  ? `EPA ${entry.current.epaTotal != null ? entry.current.epaTotal.toFixed(1) : "—"} · rank ${entry.current.rank ?? "—"} at ${entry.current.eventKey}`
                  : "No EPA data yet"}
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {entry.nextMatch
                  ? `Next: ${entry.nextMatch.compLevel.toUpperCase()} ${entry.nextMatch.matchNumber} · ${formatTime(entry.nextMatch.scheduledTime)}`
                  : "No upcoming match scheduled"}
              </small>
              {entry.note ? <small className="app-muted" style={{ display: "block" }}>{entry.note}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "remove-entry", entryId: entry.id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [teamKey, setTeamKey] = useState("");
  const [note, setNote] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = teamKey.trim().toLowerCase();
        if (!/^frc\d+$/.test(trimmed)) return;
        mutate({ action: "add-entry", teamKey: trimmed, note: note || undefined });
        setTeamKey("");
        setNote("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Watch a team</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <FormRow label="Team key" hint="e.g. frc254">
          <input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Alliance-selection watch" />
        </FormRow>
      </div>
      <div>
        <button type="submit" className="app-button" disabled={busy || !/^frc\d+$/.test(teamKey.trim().toLowerCase())}>
          Add to watchlist
        </button>
      </div>
    </Panel>
  );
}
