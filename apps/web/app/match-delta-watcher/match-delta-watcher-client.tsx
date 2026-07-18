"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { matchDeltaAlertTypeLabel, matchDeltaSeverityLabel } from "../../lib/match-delta-watcher";
import type { MatchDeltaWatcherView } from "../../lib/match-delta-watcher/compute-match-delta-watcher";

function severityTone(severity: string): string {
  if (severity === "critical") return "demo";
  if (severity === "watch") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MatchDeltaWatcherView, { status: "live" }>;

export default function MatchDeltaWatcherClient() {
  const [view, setView] = useState<MatchDeltaWatcherView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((eventOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const eventQuery = eventOverride ?? params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (eventQuery) query.set("eventKey", eventQuery);
    void fetch(`/api/match-delta-watcher${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchDeltaWatcherView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.eventKey);
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
        const response = await fetch("/api/match-delta-watcher", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MatchDeltaWatcherView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.eventKey);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, eventKey, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Match-Delta Watcher"}
          </>
        }
        title="Match-Delta Watcher"
        description="Watches official match results as they land and flags when reality diverges from our prediction model or pick-list priorities."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.events.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Event
              <select
                value={eventKey ?? view.eventKey}
                onChange={(event) => {
                  const next = event.target.value;
                  setEventKey(next);
                  load(next);
                }}
              >
                {view.events.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {view?.status === "live" ? (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => mutate({ action: "scan-event" })}
            >
              Scan for deltas
            </button>
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
          title="Could not load the match-delta watcher"
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
          <ConfigPanel view={view} busy={busy} mutate={mutate} />
          <AlertsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Watched matches", value: String(summary.totalWatchedMatches) },
    { label: "Prediction accuracy", value: pct(summary.accuracyRate) },
    { label: "Total alerts", value: String(summary.totalAlerts) },
    { label: "Critical alerts", value: String(summary.criticalAlerts) },
    { label: "Unacknowledged", value: String(summary.unacknowledgedAlerts) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
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

function ConfigPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const enabled = view.config?.enabled ?? true;
  const threshold = view.config?.upsetThreshold ?? 0.65;
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Watch settings — {view.eventKey}</h2>
          <small className="app-muted">
            {view.config ? "Configured" : "Not yet configured — using defaults until saved."}
          </small>
        </div>
        <span className={`app-badge ${enabled ? "good" : "setup"}`}>{enabled ? "Enabled" : "Disabled"}</span>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "set-config", enabled: event.target.checked, upsetThreshold: threshold })
            }
          />
          Watch this event
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Critical confidence threshold
          <input
            type="number"
            min={0.51}
            max={1}
            step={0.01}
            value={threshold}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "set-config", enabled, upsetThreshold: Number(event.target.value) || 0.65 })
            }
            style={{ width: 80 }}
          />
        </label>
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
        badge="No deltas yet"
        badgeTone="setup"
        title="No divergence detected"
        description="Run a scan once official results are posted for this event to compare them against your predictions and pick list."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Alerts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.alerts.map((alert) => (
          <li
            key={alert.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${severityTone(alert.severity)}`}>
                {matchDeltaSeverityLabel(alert.severity)}
              </span>{" "}
              <strong>
                {alert.compLevel.toUpperCase()} {alert.matchNumber} · {matchDeltaAlertTypeLabel(alert.alertType)}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {alert.summary}
              </small>
              {alert.teamsInvolved.length > 0 ? (
                <small className="app-muted">{alert.teamsInvolved.join(", ")}</small>
              ) : null}
            </div>
            {alert.acknowledged ? (
              <span className="app-muted">Acknowledged</span>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-alert", alertId: alert.id })}
              >
                Acknowledge
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
