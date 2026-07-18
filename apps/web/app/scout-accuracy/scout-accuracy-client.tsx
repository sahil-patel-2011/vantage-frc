"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { scoutAccuracyTierLabel } from "../../lib/scout-accuracy";
import type { ScoutAccuracyView } from "../../lib/scout-accuracy/compute-scout-accuracy";
import type { ScoutAccuracyScoutStat, ScoutAccuracyTier } from "../../lib/scout-accuracy/types";

function tierTone(tier: ScoutAccuracyTier): string {
  if (tier === "lead") return "good";
  if (tier === "core") return "setup";
  if (tier === "developing") return "demo";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutAccuracyView, { status: "live" }>;

export default function ScoutAccuracyClient() {
  const [view, setView] = useState<ScoutAccuracyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

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
    void fetch(`/api/scout-accuracy${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
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
        const response = await fetch("/api/scout-accuracy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ScoutAccuracyView | { error?: string };
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
            {" / Scout accuracy"}
          </>
        }
        title="Scout accuracy"
        description="Post-event, each scout's reported totals are scored against cached TBA results — ranking the roster and suggesting who's ready for the pick-desk rotation."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.events.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Event
              <select
                value={view.eventKey ?? ""}
                onChange={(event) => load(event.target.value)}
              >
                {view.events.map((eventKey) => (
                  <option key={eventKey} value={eventKey}>
                    {eventKey}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {view?.status === "live" && view.eventKey ? (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => mutate({ action: "record-snapshot", eventKey: view.eventKey })}
            >
              Record snapshot
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
          title="Could not load scout accuracy"
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
      ) : view.eventKey == null ? (
        <EmptyState
          badge="No scouting data yet"
          badgeTone="setup"
          title="No scouted matches to score"
          description="Once your team logs match-scout entries for an event with cached TBA results, accuracy scoring appears here."
        />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <Leaderboard view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary, lastSnapshot } = view;
  const tiles = [
    { label: "Entries scored", value: String(summary.totalEntries) },
    { label: "Verifiable entries", value: String(summary.verifiableEntries) },
    { label: "Scouts ranked", value: String(summary.totalScouts) },
    { label: "Avg accuracy score", value: `${summary.avgAccuracyScore}` },
    { label: "Suggested promotions", value: String(summary.suggestedPromotions) },
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
      {lastSnapshot ? (
        <p className="app-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Last recorded snapshot: {new Date(lastSnapshot.computedAt).toLocaleString()} ·{" "}
          {lastSnapshot.scoutsScored} scout(s), avg score {Math.round(lastSnapshot.avgAccuracyScore)}
        </p>
      ) : (
        <p className="app-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          No snapshot recorded yet for this event — scores below are computed live.
        </p>
      )}
    </Panel>
  );
}

function Leaderboard({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.stats.length === 0) {
    return (
      <EmptyState
        badge="No verifiable entries yet"
        badgeTone="setup"
        title="No scout accuracy data yet"
        description="Scouted totals will be scored once matches have cached official results."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Leaderboard &amp; pick-desk rotation</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.stats.map((stat) => (
          <LeaderboardRow key={stat.scoutUserId} stat={stat} busy={busy} eventKey={view.eventKey} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function LeaderboardRow({
  stat,
  busy,
  eventKey,
  mutate,
}: {
  stat: ScoutAccuracyScoutStat;
  busy: boolean;
  eventKey: string | null;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div>
        <strong>
          #{stat.rank} {stat.scoutName}
        </strong>
        <span className={`app-badge ${tierTone(stat.tier)}`} style={{ marginLeft: 8 }}>
          {scoutAccuracyTierLabel(stat.tier)}
        </span>
        <small className="app-muted" style={{ display: "block" }}>
          {stat.entriesScored} entries · {stat.verifiableEntries} verifiable · {stat.accurateEntries} accurate ·{" "}
          {pct(stat.accuracyRate)} accuracy rate
        </small>
        <small className="app-muted">
          Accuracy score {stat.accuracyScore}/100
          {stat.avgAbsErrorPct != null ? ` · avg error ${pct(stat.avgAbsErrorPct)}` : ""}
          {stat.suggestedPromote ? " · suggested for pick-desk rotation" : ""}
        </small>
      </div>
      {eventKey ? (
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "set-promotion",
              eventKey,
              scoutUserId: stat.scoutUserId,
              promoted: !stat.promoted,
            })
          }
        >
          {stat.promoted ? "Remove from rotation" : "Promote to rotation"}
        </button>
      ) : null}
    </li>
  );
}
