"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Panel, Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import { matchLabelFromKey } from "../../lib/matches/no-next-match";
import type {
  DistributeByShareResult,
  ReconcileAlliance,
} from "../../lib/scouting/reconcile";
import "./scouting-reconcile.css";

import { scopedReconcileView, type ReconcileView } from "../../lib/scouting/reconcile-view";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

const teamLabel = (teamKey: string) => teamKey.replace(/^frc/i, "") || teamKey;
const pct = (value: number | null) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
const points = (value: number | null) => (value == null ? "—" : String(Math.round(value * 10) / 10));

const FLAG_WORDS: Record<string, string> = {
  ok: "close",
  review: "check",
  partial: "not every robot scouted",
  no_scouting: "not scouted",
  no_official: "no official score yet",
};

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
          The official {points(alliance.officialTotal)} includes {points(alliance.officialFoulPoints)} foul
          points the other alliance gave away. Those are left out, because no robot here scored them.
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
                      robot.scoutCount > 1 ? ` · mean of ${robot.scoutCount}` : ""
                    }`}
                {share ? ` · estimated share of the official score ${points(share.points)}` : ""}
              </span>
              {robot.range && robot.range[0] !== robot.range[1] ? <span>Reports range {points(robot.range[0])}–{points(robot.range[1])} points; review disagreement.</span> : null}
              {robot.entryIds.length ? (
                <a href={entriesHref(orgId, matchKey, robot.teamKey)}>
                  {robot.entryIds.length} {robot.entryIds.length === 1 ? "report" : "reports"}
                </a>
              ) : (
                <span>no reports</span>
              )}
            </li>
          );
        })}
      </ul>
      {distribution.status === "unavailable" ? (
        <p>Can&apos;t split the official score by robot: {distribution.reason}</p>
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
  const [storedView, setView] = useState<ReconcileView | null>(null);
  const view = storedView && storedView.orgId === orgId && (!eventKey || storedView.eventKey === eventKey) ? storedView : null;
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [limit, setLimit] = useState(20);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const id = ++generation.current;
    setLoading(true); setError(""); setStatus(null);
    const params = new URLSearchParams({ orgId });
    if (eventKey) params.set("eventKey", eventKey);
    try {
      const response = await fetch(`/api/scouting/reconcile?${params}`, { cache: "no-store",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      const data: unknown = await response.json().catch(() => null);
      if (id !== generation.current) return;
      if (!response.ok) {
        setStatus(response.status);
        if (response.status === 401 || response.status === 403) setView(null);
        throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Alliance review could not load. Refresh to try again.");
      }
      const next = scopedReconcileView(data, orgId, eventKey);
      if (!next) throw new Error("Alliance review did not match this team and event. Refresh to try again.");
      setView(next); setLimit(20);
    } catch (failure) {
      if (id === generation.current) setError(failure instanceof Error ? failure.message : "Alliance review could not load. Refresh to try again.");
    } finally { if (id === generation.current) setLoading(false); }
  }, [eventKey, orgId]);

  useEffect(() => {
    setView(null); setOnlyFlagged(true); setLimit(20); void load();
    return () => { ++generation.current; controller.current?.abort(); };
  }, [load]);

  const visible = useMemo(() => {
    if (view?.status !== "live") return [];
    return onlyFlagged && view.summary.flaggedMatches
      ? view.matches.filter((match) => match.needsReview)
      : view.matches;
  }, [onlyFlagged, view]);

  const failure = loadFailureCopy(classifyLoadFailure({ status, message: error,
    online: typeof navigator === "undefined" ? true : navigator.onLine }), {
      message: error, nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
    });
  if (error && !view) return <Panel><EmptyState title={failure.title} description={failure.description} badge={failure.badge}>
    {failure.primary ? <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button> : null}
    {failure.showRetry ? <Button variant="secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</Button> : null}
  </EmptyState></Panel>;

  if (!view) {
    return (
      <Panel>
        <span className="eyebrow">RECONCILIATION</span>
        <h2>Scouted vs official</h2>
        <p className="app-muted">Comparing what your scouts recorded to the official scores…</p>
      </Panel>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Panel>
        <span className="eyebrow">RECONCILIATION</span>
        <h2>Scouted vs official</h2>
        <EmptyState title="Nothing to reconcile yet" description={view.message}>
          <Button as="a" variant="primary" href={withOrgHref(view.eventKey ? `/scouting?eventKey=${encodeURIComponent(view.eventKey)}` : "/competition?tab=command", orgId)}>
            {view.eventKey ? "Open Scouting" : "Choose event"}
          </Button>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</Button>
        </EmptyState>
      </Panel>
    );
  }

  const threshold = Math.round(view.reviewDeltaPct * 100);
  const finalScoresOnly = view.matches.some(
    (match) => match.red.officialSource === "alliance_score" || match.blue.officialSource === "alliance_score",
  );

  return (
    <Panel>
      <h2>Alliance review</h2>
      <p className="app-muted">{view.summary.matches} played qualification matches · {view.scoutedEntries} reports. Robot shares are estimates from scouting proportions, not official robot measurements.</p>
      {error ? <p className="form-message" role="status">{error} Previously loaded observations remain visible.</p> : null}
      <div className="recon">
        {finalScoresOnly ? (
          <p className="app-muted">
            This event posts only each alliance&apos;s final score, so foul points are still inside the official
            number. Expect your scouts&apos; totals to read a little under it.
          </p>
        ) : null}
        <section className="recon-kpis">
          <article>
            <span>Flagged matches</span>
            <strong>{view.summary.flaggedMatches}</strong>
            <small>over {threshold}% gap</small>
          </article>
          <article>
            <span>Alliances compared</span>
            <strong>{view.summary.comparedAlliances}</strong>
            <small>all 3 robots scouted</small>
          </article>
          <article>
            <span>Average gap</span>
            <strong>
              {view.summary.meanAbsDeltaPct == null
                ? "—"
                : `${Math.round(view.summary.meanAbsDeltaPct * 100)}%`}
            </strong>
            <small>{view.scoutedEntries} reports</small>
          </article>
          <article>
            <span>No official score</span>
            <strong>{view.summary.matchesWithoutBreakdown}</strong>
            <small>not posted yet</small>
          </article>
        </section>

        {!view.summary.comparedAlliances ? (
          <EmptyState
            title="No alliance is comparable yet"
            description={`An alliance is compared once all three of its robots have a scouted point number and the match has an official score. ${view.summary.matchesWithoutScouting} played match${
              view.summary.matchesWithoutScouting === 1 ? " has" : "es have"
            } no scouted numbers at all.`}
          />
        ) : null}

        <div className="recon-actions">
          <Button variant="secondary" type="button" onClick={() => { setOnlyFlagged(value => !value); setLimit(20); }} disabled={!view.summary.flaggedMatches}>
            {onlyFlagged && view.summary.flaggedMatches
              ? `Show all ${view.matches.length}`
              : `Only ${view.summary.flaggedMatches} flagged`}
          </Button>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="recon-list">
          {visible.slice(0, limit).map((match) => (
            <article className="recon-match" key={match.matchKey}>
              <header>
                <h3>{matchLabelFromKey(match.matchKey)}</h3>
                <span className={`recon-chip ${match.needsReview ? "review" : match.flag === "ok" ? "ok" : ""}`}>
                  {match.needsReview
                    ? `review · ${pct(match.worstDeltaPct)}`
                    : match.worstDeltaPct != null
                      ? `within ${threshold}%`
                      : (FLAG_WORDS[match.flag] ?? "")}
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

        {visible.length > limit ? <Button variant="secondary" type="button" onClick={() => setLimit(value => value + 20)}>Show {Math.min(20, visible.length - limit)} more matches</Button> : null}
        <p className="app-muted" role="status">Showing {Math.min(limit, visible.length)} of {visible.length} {onlyFlagged && view.summary.flaggedMatches ? "flagged " : ""}matches.</p>
        {view.truncated ? (
          <p className="app-muted">
            Showing the {view.matches.length} matches with the largest gaps out of{" "}
            {view.summary.matches} played quals.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
