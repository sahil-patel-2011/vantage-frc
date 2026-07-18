"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import type { CoverageStatus } from "../../lib/scout-coverage-live/types";
import type { ScoutCoverageLiveView } from "../../lib/scout-coverage-live/compute-scout-coverage-live";

function statusTone(status: CoverageStatus): string {
  if (status === "zero") return "demo";
  if (status === "thin") return "setup";
  return "good";
}

function statusLabel(status: CoverageStatus): string {
  if (status === "zero") return "No coverage";
  if (status === "thin") return "Thin";
  return "Covered";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutCoverageLiveView, { status: "live" }>;

export default function ScoutCoverageLiveClient() {
  const [view, setView] = useState<ScoutCoverageLiveView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const urlEvent = params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (urlEvent) query.set("eventKey", urlEvent);
    void fetch(`/api/scout-coverage-live${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
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
        const eventKey = view && view.status === "live" ? view.eventKey : undefined;
        const response = await fetch("/api/scout-coverage-live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey, ...payload }),
        });
        const data = (await response.json()) as ScoutCoverageLiveView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setThresholdInput(String(data.thinThreshold));
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, view, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Coverage Live"}
          </>
        }
        title="Scout Coverage Live"
        description="A live grid of which teams and matches have zero or thin scouting coverage, with push nudges to the coordinator mid-event."
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
          title="Could not load Scout Coverage Live"
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
          <SummaryPanel view={view} busy={busy} thresholdInput={thresholdInput} setThresholdInput={setThresholdInput} mutate={mutate} />
          <CoverageGrid view={view} busy={busy} mutate={mutate} />
          <NudgeLog view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({
  view,
  busy,
  thresholdInput,
  setThresholdInput,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  thresholdInput: string;
  setThresholdInput: (value: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { summary } = view;
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="app-muted">Event</span>
          <h2 style={{ margin: "2px 0 0" }}>{view.eventKey}</h2>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(summary.coveragePct)} covered</strong>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 12 }}>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{summary.totalCells}</strong>
          <span className="app-muted">Assignments</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{summary.zeroCount}</strong>
          <span className="app-muted">No coverage</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{summary.thinCount}</strong>
          <span className="app-muted">Thin</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{summary.coveredCount}</strong>
          <span className="app-muted">Covered</span>
        </div>
      </div>
      <form
        style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16, flexWrap: "wrap" }}
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(thresholdInput);
          if (Number.isFinite(value) && value > 0) mutate({ action: "set-threshold", thinThreshold: Math.round(value) });
        }}
      >
        <FormRow label="Thin threshold (entries per team/match)">
          <input
            type="number"
            min={1}
            value={thresholdInput}
            onChange={(event) => setThresholdInput(event.target.value)}
            style={{ width: 100 }}
          />
        </FormRow>
        <button type="submit" className="app-button secondary" disabled={busy}>
          Save threshold
        </button>
      </form>
    </Panel>
  );
}

function CoverageGrid({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.cells.length === 0) {
    return (
      <EmptyState
        badge="No schedule"
        badgeTone="setup"
        title="No match/team assignments to grade yet"
        description="Once the event schedule syncs, this grid will populate automatically."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Coverage gaps</h2>
      {view.gaps.length === 0 ? (
        <p className="app-muted">No zero or thin coverage right now — every scheduled team/match meets the threshold.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {view.gaps.map((cell) => (
              <li
                key={`${cell.matchKey}::${cell.teamKey}`}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
              >
                <div>
                  <span className={`app-badge ${statusTone(cell.status)}`}>{statusLabel(cell.status)}</span>{" "}
                  <strong>{cell.matchLabel}</strong>
                  <span className="app-muted"> · Team {cell.teamNumber} ({cell.alliance}) · {cell.entryCount} entr{cell.entryCount === 1 ? "y" : "ies"}</span>
                </div>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      action: "send-nudge",
                      matchKey: cell.matchKey,
                      teamKey: cell.teamKey,
                      message: `${cell.matchLabel}: Team ${cell.teamNumber} has ${cell.entryCount} scouting entr${cell.entryCount === 1 ? "y" : "ies"} — send a scout.`,
                    })
                  }
                >
                  Nudge coordinator
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function NudgeLog({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.nudges.length === 0) {
    return (
      <EmptyState
        badge="No nudges yet"
        badgeTone="setup"
        title="No coverage nudges sent"
        description="Send a nudge from the coverage gaps above and it will show up here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Nudge log</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.nudges.map((nudge) => (
          <li key={nudge.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{nudge.matchLabel}</strong>
              <span className="app-muted"> · Team {nudge.teamNumber}</span>
              <small className="app-muted" style={{ display: "block" }}>
                {nudge.message}
              </small>
              <small className="app-muted">
                Sent {new Date(nudge.sentAt).toLocaleString()}
                {nudge.acknowledged ? " · Acknowledged" : ""}
              </small>
            </div>
            {!nudge.acknowledged ? (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-nudge", nudgeId: nudge.id })}
              >
                Acknowledge
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
