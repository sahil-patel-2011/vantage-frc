"use client";

import { staleCopyNotice } from "../../lib/ui/stale-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button, Skeleton, StatRowSkeleton, TableSkeleton } from "../../components/ui";
import {
  bestPath,
  describeBestPath,
  describeFlip,
  outcomeFor,
  seedProjection,
  type AllianceOutcome,
  type BestPathResult,
  type OutcomeOverrides,
} from "../../lib/best-path";
import type {
  RankingProjectionView,
  RankingProjectionWhatIf,
} from "../../lib/ranking-projection/compute-ranking-projection";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./ranking-projection.css";

const teamLabel = (teamKey: string) => teamKey.replace(/^frc/i, "") || teamKey;
const allianceLabel = (teamKeys: string[]) =>
  teamKeys.length ? teamKeys.map(teamLabel).join(" ") : "—";

function formatRating(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function unpredictedSentence(count: number): string {
  if (count === 1) {
    return "One match has no win chance yet, because a robot in it has no rating. Set that match by hand.";
  }
  return `${count} matches have no win chance yet, because a robot in them has no rating. Set those matches by hand.`;
}

export type RankingProjectionInitial = RankingProjectionView | "loading" | "error";

function isRankingProjectionView(value: unknown): value is RankingProjectionView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function rankingProjectionCacheOrg(data: RankingProjectionView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistRankingProjectionSnapshot(
  orgHint: string,
  data: RankingProjectionView,
): Promise<void> {
  const cacheOrg = rankingProjectionCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("ranking-projection", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("ranking-projection", "_", data);
  } catch {
    // Live ranking projection already painted; IndexedDB is best-effort.
  }
}

/**
 * Best Path seed planner. Every number below comes from the cached standings and
 * the real remaining schedule the API returned; toggling a match only re-runs the
 * pure simulator in the browser. Nothing here invents a match, a team, or a seed.
 */
function BestPathPlanner({
  whatIf,
  teamKey,
  eventName,
}: {
  whatIf: RankingProjectionWhatIf;
  teamKey: string;
  eventName: string;
}) {
  const [overrides, setOverrides] = useState<OutcomeOverrides>({});
  const [plan, setPlan] = useState<BestPathResult | null>(null);
  const [onlyOurMatches, setOnlyOurMatches] = useState(true);

  const projection = useMemo(
    () => seedProjection(whatIf.standings, whatIf.remaining, overrides, whatIf.rules),
    [overrides, whatIf.remaining, whatIf.rules, whatIf.standings],
  );
  const ours = projection.byTeam[teamKey] ?? null;

  const ourMatches = useMemo(
    () =>
      whatIf.remaining.filter(
        (match) => match.red.includes(teamKey) || match.blue.includes(teamKey),
      ),
    [teamKey, whatIf.remaining],
  );
  const visibleMatches = onlyOurMatches && ourMatches.length ? ourMatches : whatIf.remaining;

  const setOutcome = useCallback((matchKey: string, outcome: AllianceOutcome | null) => {
    setPlan(null);
    setOverrides((current) => {
      const next = { ...current };
      if (outcome == null) delete next[matchKey];
      else next[matchKey] = outcome;
      return next;
    });
  }, []);

  const runBestPath = useCallback(() => {
    setPlan(
      bestPath({
        teamKey,
        standings: whatIf.standings,
        remainingMatches: whatIf.remaining,
        overrides,
        rules: whatIf.rules,
      }),
    );
  }, [overrides, teamKey, whatIf.remaining, whatIf.rules, whatIf.standings]);

  const applyPlan = useCallback(() => {
    if (!plan?.flips.length) return;
    setOverrides((current) => {
      const next = { ...current };
      for (const flip of plan.flips) next[flip.matchKey] = flip.outcome;
      return next;
    });
  }, [plan]);

  const forcedCount = Object.keys(overrides).length;
  const delta = ours?.rankDelta ?? null;

  if (!whatIf.remaining.length) {
    return (
      <Panel>
        <span className="eyebrow">Seed plan</span>
        <h2>Every qualification match is played</h2>
        <p className="app-muted">
          {eventName} has no qualification matches left to play, so there is nothing left to plan. The
          rank above is the finished seed order.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
        <span className="eyebrow">Seed plan</span>
        <h2>What if the rest of the qualifications</h2>
      <div className="bp-planner">
        <section className="bp-kpis">
          <article>
            <span>Projected seed</span>
            <strong className={delta == null ? "" : delta > 0 ? "bp-up" : delta < 0 ? "bp-down" : ""}>
              {ours ? ours.projectedRank : "—"}
            </strong>
            <small>
              {ours?.currentRank != null
                ? `now ${ours.currentRank}${delta ? ` · ${delta > 0 ? "+" : ""}${delta}` : ""}`
                : "no official rank"}
            </small>
          </article>
          {(() => {
            // The rest of quals played out many times: odds, not one guess.
            const odds = whatIf.seedOdds?.teams.find((row) => row.teamKey === teamKey);
            if (!odds || !whatIf.seedOdds) return null;
            const pct = Math.round(odds.captainChance * 100);
            return (
              <article data-testid="bp-captain-odds">
                <span>Chance to captain</span>
                {/* Odds from simulated finishes, never a certainty: "100%" read as a promise. */}
                <strong>
                  {odds.captainChance >= 0.99 ? "99%+" : pct < 1 && odds.captainChance > 0 ? "<1%" : `${pct}%`}
                </strong>
                <small>
                  {odds.bestLikelySeed === odds.worstLikelySeed
                    ? `seed ${odds.medianSeed} in almost every finish`
                    : `usually seed ${odds.bestLikelySeed}–${odds.worstLikelySeed}`}
                </small>
              </article>
            );
          })()}
          <article>
            <span>Ranking points</span>
            <strong>{ours ? ours.projectedRankingPoints : "—"}</strong>
            <small>{ours ? `${ours.rankingPoints} banked` : "no standings row"}</small>
          </article>
          <article>
            <span>Forced results</span>
            <strong>{forcedCount}</strong>
            <small>{projection.decidedMatches} of {whatIf.remaining.length} decided</small>
          </article>
          <article>
            <span>Not set</span>
            <strong>{projection.undecidedMatches}</strong>
            <small>no win chance, and not set by hand</small>
          </article>
        </section>

        {/* One short line up front; the rest of the fine print behind "About these numbers". The
            rules line and the "not confirmed" caveat said the same thing twice. */}
        <details className="bp-caveats-more">
          <summary data-disclosure>About these numbers</summary>
        <ul className="bp-caveats">
          {whatIf.rules.confirmed ? (
            <li>
              A win is {whatIf.rules.win} ranking points and a tie is {whatIf.rules.tie}.
            </li>
          ) : null}
          {whatIf.seedOdds ? (
            <li>
              Chance to captain plays the remaining qualification matches {whatIf.seedOdds.iterations.toLocaleString()} times from each
              match&apos;s win chance and counts how often we finish in the top {whatIf.seedOdds.captains}
              {whatIf.seedOdds.unpredictedMatches
                ? `; ${whatIf.seedOdds.unpredictedMatches} match${whatIf.seedOdds.unpredictedMatches === 1 ? " has" : "es have"} no prediction and count as a coin flip`
                : ""}
              .
            </li>
          ) : null}
          {whatIf.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
          {projection.unknownTeams.length ? (
            <li>
              {projection.unknownTeams.length} scheduled team
              {projection.unknownTeams.length === 1 ? "" : "s"} have no standings row and are left out
              of the seed order: {projection.unknownTeams.map(teamLabel).join(", ")}.
            </li>
          ) : null}
        </ul>
        </details>

        <div className="bp-actions">
          <Button variant="primary" type="button" onClick={runBestPath}>
            Show best path
          </Button>
          {plan?.flips.length ? (
            <Button variant="secondary" type="button" onClick={applyPlan}>
              Apply these results
            </Button>
          ) : null}
          {forcedCount ? (
            <Button variant="secondary" type="button" onClick={() => { setOverrides({}); setPlan(null); }}>
              Clear {forcedCount} forced
            </Button>
          ) : null}
          {ourMatches.length ? (
            <Button variant="secondary" type="button" onClick={() => setOnlyOurMatches((value) => !value)}>
              {onlyOurMatches ? `Show all ${whatIf.remaining.length}` : `Only our ${ourMatches.length}`}
            </Button>
          ) : null}
        </div>

        {plan ? (
          <div className="bp-path" role="status">
            <strong>{describeBestPath(plan)}</strong>
            {plan.flips.length ? (
              <ol>
                {plan.flips.map((flip) => (
                  <li key={flip.matchKey}>
                    {describeFlip(flip, teamKey)}
                    <small>
                      {flip.predicted
                        ? `predicted ${flip.predicted === "tie" ? "tie" : `${flip.predicted} win`}`
                        : "no prediction on this match"}
                    </small>
                  </li>
                ))}
              </ol>
            ) : null}
            <small className="app-muted">
              Searched {plan.evaluations} scenario{plan.evaluations === 1 ? "" : "s"} across{" "}
              {plan.candidateMatches} of {plan.consideredMatches} open matches, up to{" "}
              {plan.depthSearched} flip{plan.depthSearched === 1 ? "" : "s"} at once.
              {plan.capped
                ? ` This search was capped, so a better path may exist. ${plan.cappedReason ?? ""}`
                : plan.cappedReason
                  ? ` ${plan.cappedReason}`
                  : ""}
            </small>
          </div>
        ) : null}

        {whatIf.unpredictedMatches > 0 ? (
          <p className="bp-partial">{unpredictedSentence(whatIf.unpredictedMatches)}</p>
        ) : null}

        <div className="bp-match-list">
          {visibleMatches.map((match) => {
            const forced = overrides[match.matchKey] ?? null;
            const effective = outcomeFor(match, overrides);
            const ourSide = match.red.includes(teamKey)
              ? "red"
              : match.blue.includes(teamKey)
                ? "blue"
                : null;
            const inPlan = plan?.flips.some((flip) => flip.matchKey === match.matchKey) ?? false;
            return (
              <article
                key={match.matchKey}
                className={forced || inPlan ? "bp-match bp-forced" : "bp-match"}
              >
                <div>
                  <b className="bp-match-id">Q{match.matchNumber}</b>
                  <span className="bp-match-teams">
                    <b>{allianceLabel(match.red)}</b> vs <b>{allianceLabel(match.blue)}</b>
                    {ourSide ? ` · we are ${ourSide}` : ""}
                  </span>
                  <span className="bp-match-note">
                    {match.predicted
                      ? `Predicted: ${match.predicted === "tie" ? "tie" : `${match.predicted} wins`}`
                      : "No win chance yet. A robot in this match has no rating."}
                    {forced
                      ? ` · forced ${forced === "tie" ? "tie" : `${forced} wins`}`
                      : effective == null
                        ? " · changes no ranking points until you set a winner"
                        : ""}
                  </span>
                </div>
                <div className="bp-toggle" role="group" aria-label={`Outcome for qualification ${match.matchNumber}`}>
                  <button
                    type="button"
                    aria-pressed={forced == null}
                    onClick={() => setOutcome(match.matchKey, null)}
                  >
                    {match.predicted ? "Predicted" : "Not set"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={forced === "red"}
                    onClick={() => setOutcome(match.matchKey, "red")}
                  >
                    {ourSide === "red" ? "We win" : ourSide === "blue" ? "We lose" : "Red"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={forced === "blue"}
                    onClick={() => setOutcome(match.matchKey, "blue")}
                  >
                    {ourSide === "blue" ? "We win" : ourSide === "red" ? "We lose" : "Blue"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={forced === "tie"}
                    onClick={() => setOutcome(match.matchKey, "tie")}
                  >
                    Tie
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="bp-scroll">
          <table className="bp-standings">
            <caption className="app-muted">
              Projected seed order — ties fall back to the current official rank.
            </caption>
            <thead>
              <tr>
                <th scope="col">Seed</th>
                <th scope="col">Team</th>
                <th scope="col">Projected</th>
                <th scope="col">Now</th>
                <th scope="col">Not set</th>
              </tr>
            </thead>
            <tbody>
              {projection.rows.slice(0, 24).map((row) => (
                <tr key={row.teamKey} className={row.teamKey === teamKey ? "bp-ours" : undefined}>
                  <td>{row.projectedRank}</td>
                  <td>{teamLabel(row.teamKey)}</td>
                  <td>{row.projectedRankingPoints}</td>
                  <td>{row.currentRank ?? "—"}</td>
                  <td>{row.undecidedMatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function RankingProjectionSkeleton() {
  return (
    <div className="rp-loading" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading ranking projection</p>
      <Panel>
        <Skeleton width="42%" height={18} />
        <Skeleton width="28%" height={14} />
        <Skeleton width="36%" height={14} />
        <Skeleton width={148} height={40} radius={999} />
      </Panel>
      <Panel>
        <StatRowSkeleton count={4} />
        <TableSkeleton rows={6} cols={5} />
      </Panel>
    </div>
  );
}

export default function RankingProjectionClient({ initial }: { initial?: RankingProjectionInitial } = {}) {
  const [view, setView] = useState<RankingProjectionView | null>(
    initial && initial !== "loading" && initial !== "error" ? initial : null,
  );
  const [error, setError] = useState(initial === "error" ? "Ranking projection could not be loaded." : "");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(initial === "error" ? 500 : null);
  const [fetchFailed, setFetchFailed] = useState(initial === "error");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<RankingProjectionView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<RankingProjectionView>(
        "ranking-projection",
        orgHint || "_",
      );
      if (!viewRef.current && cached?.data && isRankingProjectionView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/ranking-projection${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data = (await response.json()) as RankingProjectionView | { error?: string };
      if (!response.ok || !isRankingProjectionView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError(staleCopyNotice("Ranking projection"));
          setFetchFailed(false);
        } else {
          setError(
            "error" in data && data.error ? data.error : "Could not load ranking projection.",
          );
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistRankingProjectionSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError(staleCopyNotice("Ranking projection"));
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    if (initial !== undefined) return;
    void load();
  }, [initial, load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const failure =
    !view && fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Ranking projection"}
          </>
        }
        title="Ranking projection"
        description="Where your team is likely to finish, from the matches already saved for this event."
      >
        <Button as="a" variant="secondary" href={withOrgHref("/match-sim", orgId)}>
          Match prediction
        </Button>
      </PageHeader>
      <OfflineBanner feature="Ranking projection" fromCache={fromCache} cachedAt={cachedAt} />
      {error && view ? <p className="app-muted">{error}</p> : null}
      {!view && !failure ? <RankingProjectionSkeleton /> : null}
      {!view && failure ? (
        <EmptyState
          soft
          badge={failure.badge}
          badgeTone={failure.kind === "setup" ? "setup" : "error"}
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : null}
      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          soft
          title={view.steps[0]?.label ?? "Choose your team"}
          description={view.message}
        >
          <Button as="a" variant="primary" href={view.steps[0]?.href ?? "/workspace"}>
            {view.steps[0]?.label ?? "Choose your team"}
          </Button>
        </EmptyState>
      ) : null}
      {view?.status === "live" ? (
        <>
          <Panel>
            <div className="rp-summary">
              <p className="rp-summary-event">{view.eventName}</p>
              <p>
                Rank {view.currentRank}
                {view.record ? ` · ${view.record}` : ""}
              </p>
              <p>
                {view.playedQuals} qualification {view.playedQuals === 1 ? "match" : "matches"} played,{" "}
                {view.remainingQuals} remaining
                {view.whatIf?.ratingSource === "season" && view.epaTotal != null && Number.isFinite(Number(view.epaTotal))
                  ? ` · Season rating ${formatRating(Number(view.epaTotal))}`
                  : ""}
              </p>
            </div>
            <p>
              <Button as="a" variant="secondary" href={withOrgHref("/rankings", view.orgId)}>
                Open rankings
              </Button>
            </p>
          </Panel>
          {view.whatIf ? (
            <BestPathPlanner
              whatIf={view.whatIf}
              teamKey={view.teamKey}
              eventName={view.eventName}
            />
          ) : (
            <EmptyState
              title="No seed path to plan yet"
              description={
                view.whatIfMessage ??
                "The saved standings and remaining schedule for this event are not complete enough to project a seed."
              }
            />
          )}
        </>
      ) : null}
    </main>
  );
}
