"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Panel } from "../../components/ui";
import type {
  DistributeByShareResult,
  ReconcileAlliance,
  ReconcileSummary,
  ReconciledMatch,
} from "../../lib/scouting/reconcile";
import "./scouting-reconcile.css";

type ReconcileMatchView = ReconciledMatch & {
  distribution: { red: DistributeByShareResult; blue: DistributeByShareResult };
};

type ReconcileView =
  | { status: "setup_required"; eventKey: string | null; generatedAt: string; message: string }
  | {
      status: "live";
      eventKey: string;
      generatedAt: string;
      reviewDeltaPct: number;
      summary: ReconcileSummary;
      scoutedEntries: number;
      truncated: boolean;
      matches: ReconcileMatchView[];
    };

const teamLabel = (teamKey: string) => teamKey.replace(/^frc/i, "") || teamKey;
const pct = (value: number | null) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
const points = (value: number | null) => (value == null ? "—" : String(Math.round(value * 10) / 10));

function entriesHref(orgId: string, matchKey: string, teamKey: string) {
  // scoutTab pins the destination so the link always lands on the match form
  // with this robot's match + team already selected.
  const params = new URLSearchParams({ orgId, scoutTab: "match", matchKey, teamKey });
  return `/scouting?${params.toString()}`;
}

function AllianceBlock({
  alliance,
  distribution,
  matchKey,
  orgId,
}: {
  alliance: ReconcileAlliance;
  distribution: DistributeByShareResult;
  matchKey: string;
  orgId: string;
}) {
  return (
    <div className="recon-alliance">
      <b>
        {alliance.side === "red" ? "Red" : "Blue"} · scouted {points(alliance.ourTotal)} vs official{" "}
        {points(alliance.officialScoringTotal)}
        {alliance.deltaPct != null && (alliance.flag === "ok" || alliance.flag === "review")
          ? ` · ${pct(alliance.deltaPct)}`
          : ""}
      </b>
      <p>{alliance.message}</p>
      {alliance.officialFoulPoints ? (
        <p>
          Official total {points(alliance.officialTotal)} includes{" "}
          {points(alliance.officialFoulPoints)} foul points the opponent gave away — those are not
          compared, because no robot here scored them.
        </p>
      ) : null}
      <ul className="recon-robots">
        {alliance.robots.map((robot) => {
          const share =
            distribution.status === "distributed"
              ? distribution.robots.find((row) => row.teamKey === robot.teamKey)
              : undefined;
          return (
            <li key={robot.teamKey}>
              <b>{teamLabel(robot.teamKey)}</b>
              <span>
                {robot.estimate == null
                  ? "not scouted"
                  : `scouted ${points(robot.estimate)}${
                      robot.scoutCount > 1 ? ` · median of ${robot.scoutCount}` : ""
                    }`}
                {share ? ` · official share ${points(share.points)}` : ""}
              </span>
              {robot.entryIds.length ? (
                <a href={entriesHref(orgId, matchKey, robot.teamKey)}>
                  {robot.entryIds.length} entr{robot.entryIds.length === 1 ? "y" : "ies"}
                </a>
              ) : (
                <span>no entries</span>
              )}
            </li>
          );
        })}
      </ul>
      {distribution.status === "unavailable" ? (
        <p>Distribute-by-share unavailable — {distribution.reason}</p>
      ) : null}
    </div>
  );
}

/**
 * Additive reconciliation section for the scouting trust panel: our scouts'
 * summed alliance totals against the official TBA score breakdown, worst gap
 * first. Every state is honest — no event, no breakdown, or no scouted numbers
 * says so instead of showing a fabricated delta.
 */
export default function ScoutingReconciliationPanel({
  orgId,
  eventKey,
}: {
  orgId: string;
  eventKey: string | null;
}) {
  const [view, setView] = useState<ReconcileView | null>(null);
  const [error, setError] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ orgId });
    if (eventKey) params.set("eventKey", eventKey);
    try {
      const response = await fetch(`/api/scouting/reconcile?${params.toString()}`);
      const data = (await response.json()) as ReconcileView & { error?: string };
      if (!response.ok || !("status" in data)) {
        setError(data.error ?? "Could not load reconciliation.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Network error — reconciliation could not load.");
    }
  }, [eventKey, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (view?.status !== "live") return [];
    return onlyFlagged && view.summary.flaggedMatches
      ? view.matches.filter((match) => match.needsReview)
      : view.matches;
  }, [onlyFlagged, view]);

  if (error && !view) {
    return (
      <Panel>
        <span className="eyebrow">RECONCILIATION</span>
        <h2>Scouted vs official</h2>
        <p className="app-muted">{error}</p>
        <button type="button" className="app-button secondary" onClick={() => void load()}>
          Retry
        </button>
      </Panel>
    );
  }

  if (!view) {
    return (
      <Panel>
        <span className="eyebrow">RECONCILIATION</span>
        <h2>Scouted vs official</h2>
        <p className="app-muted">Comparing scouted totals to the official score breakdowns…</p>
      </Panel>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Panel>
        <span className="eyebrow">RECONCILIATION</span>
        <h2>Scouted vs official</h2>
        <EmptyState title="Nothing to reconcile yet" description={view.message} />
      </Panel>
    );
  }

  const threshold = Math.round(view.reviewDeltaPct * 100);

  return (
    <Panel>
      <span className="eyebrow">RECONCILIATION</span>
      <h2>Scouted vs official</h2>
      <div className="recon">
        <section className="recon-kpis">
          <article>
            <span>Flagged matches</span>
            <strong>{view.summary.flaggedMatches}</strong>
            <small>over {threshold}% gap</small>
          </article>
          <article>
            <span>Alliances compared</span>
            <strong>{view.summary.comparedAlliances}</strong>
            <small>fully scouted + official</small>
          </article>
          <article>
            <span>Average gap</span>
            <strong>
              {view.summary.meanAbsDeltaPct == null
                ? "—"
                : `${Math.round(view.summary.meanAbsDeltaPct * 100)}%`}
            </strong>
            <small>{view.scoutedEntries} entries</small>
          </article>
          <article>
            <span>No breakdown</span>
            <strong>{view.summary.matchesWithoutBreakdown}</strong>
            <small>TBA has not published</small>
          </article>
        </section>

        {!view.summary.comparedAlliances ? (
          <EmptyState
            title="No alliance is comparable yet"
            description={`Reconciliation needs all three robots on an alliance scouted with a scoring number AND a cached TBA score breakdown for that match. ${view.summary.matchesWithoutScouting} played match${
              view.summary.matchesWithoutScouting === 1 ? "" : "es"
            } have no scouted numbers at all.`}
          />
        ) : null}

        <div className="recon-actions">
          <button
            type="button"
            className="app-button secondary"
            onClick={() => setOnlyFlagged((value) => !value)}
            disabled={!view.summary.flaggedMatches}
          >
            {onlyFlagged && view.summary.flaggedMatches
              ? `Show all ${view.matches.length}`
              : `Only ${view.summary.flaggedMatches} flagged`}
          </button>
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <div className="recon-list">
          {visible.map((match) => (
            <article className="recon-match" key={match.matchKey}>
              <header>
                <h3>
                  {match.compLevel.toUpperCase()} {match.matchNumber}
                </h3>
                <span className={`recon-chip ${match.needsReview ? "review" : "ok"}`}>
                  {match.needsReview
                    ? `review · ${pct(match.worstDeltaPct)}`
                    : match.worstDeltaPct != null
                      ? `within ${threshold}%`
                      : match.flag.replaceAll("_", " ")}
                </span>
              </header>
              <AllianceBlock
                alliance={match.red}
                distribution={match.distribution.red}
                matchKey={match.matchKey}
                orgId={orgId}
              />
              <AllianceBlock
                alliance={match.blue}
                distribution={match.distribution.blue}
                matchKey={match.matchKey}
                orgId={orgId}
              />
            </article>
          ))}
        </div>

        {view.truncated ? (
          <p className="app-muted">
            Showing the {view.matches.length} matches with the largest gaps out of{" "}
            {view.summary.matches} played quals.
          </p>
        ) : null}
        {error ? <p className="app-muted">{error}</p> : null}
      </div>
    </Panel>
  );
}
