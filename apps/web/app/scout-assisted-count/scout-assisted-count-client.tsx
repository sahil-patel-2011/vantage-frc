"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { countMetricLabel } from "../../lib/scout-assisted-count";
import {
  COUNT_METRIC_KEYS,
  type CountMetricKey,
  type ScoutAssistedCountView,
} from "../../lib/scout-assisted-count/compute-scout-assisted-count";

type LiveView = Extract<ScoutAssistedCountView, { status: "live" }>;

export default function ScoutAssistedCountClient() {
  const [view, setView] = useState<ScoutAssistedCountView | null>(null);
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
    void fetch(`/api/scout-assisted-count${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutAssistedCountView | { error?: string };
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
        const response = await fetch("/api/scout-assisted-count", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ScoutAssistedCountView | { error?: string };
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
            {" / Scout-Assisted Count"}
          </>
        }
        title="Scout-Assisted Count"
        description="Tap a counter button during a match instead of typing a number. Every tap is retained as a raw log so the tally can be audited or corrected."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Scout-Assisted Count"
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
          <StartSessionForm busy={busy} mutate={mutate} />
          <Sessions view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sessions", value: String(summary.totalSessions) },
    { label: "Open", value: String(summary.openSessions) },
    { label: "Closed", value: String(summary.closedSessions) },
    { label: "Total taps", value: String(summary.totalTaps) },
    { label: "Avg taps / session", value: String(summary.averageTapsPerSession) },
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

function StartSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState("");
  const [metricKey, setMetricKey] = useState<CountMetricKey>("cycles");
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) return;
        mutate({
          action: "start-session",
          label,
          metricKey,
          matchKey: matchKey || undefined,
          teamKey: teamKey || undefined,
        });
        setLabel("");
        setMatchKey("");
        setTeamKey("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Start a counting session</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Opponent auto cycles"
            required
          />
        </FormRow>
        <FormRow label="Metric">
          <select value={metricKey} onChange={(event) => setMetricKey(event.target.value as CountMetricKey)}>
            {COUNT_METRIC_KEYS.map((key) => (
              <option key={key} value={key}>
                {countMetricLabel(key)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={matchKey} onChange={(event) => setMatchKey(event.target.value)} placeholder="2026casj_qm12" />
        </FormRow>
        <FormRow label="Team key (optional)">
          <input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !label.trim()}>
          Start session
        </button>
      </div>
    </Panel>
  );
}

function Sessions({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sessions.length === 0) {
    return (
      <EmptyState
        badge="No sessions yet"
        badgeTone="setup"
        title="Start your first counting session"
        description="Tap the counter during a match — the tally auto-fills your scouting field, and every tap is retained for audit."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.sessions.map((s) => (
          <li key={s.id} className="app-card soft-panel" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{s.label}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {countMetricLabel(s.metricKey)}
                  {s.matchKey ? ` · ${s.matchKey}` : ""}
                  {s.teamKey ? ` · ${s.teamKey}` : ""}
                </small>
              </div>
              <span className={`app-badge ${s.status === "open" ? "good" : ""}`}>{s.status.toUpperCase()}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <strong style={{ fontSize: "2.2rem" }}>{s.tapCount}</strong>
              {s.status === "open" ? (
                <>
                  <button
                    type="button"
                    className="app-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "tap", sessionId: s.id, delta: 1 })}
                  >
                    + Tap
                  </button>
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy || s.tapCount === 0}
                    onClick={() => mutate({ action: "tap", sessionId: s.id, delta: -1 })}
                  >
                    − Undo tap
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "close-session", sessionId: s.id })}
                  >
                    Close session
                  </button>
                </>
              ) : (
                <small className="app-muted">
                  Closed {s.closedAt ? new Date(s.closedAt).toLocaleString() : ""}
                </small>
              )}
            </div>
            {s.taps.length > 0 ? (
              <details>
                <summary className="app-muted">Raw tap log ({s.taps.length})</summary>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
                  {s.taps.map((tap) => (
                    <li key={tap.id} className="app-muted" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{tap.delta > 0 ? `+${tap.delta}` : tap.delta}</span>
                      <span>{new Date(tap.tappedAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
