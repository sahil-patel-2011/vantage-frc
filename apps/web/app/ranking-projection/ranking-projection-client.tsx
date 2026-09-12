"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
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
        <span className="eyebrow">BEST PATH</span>
        <h2>Every qualification match is played</h2>
        <p className="app-muted">
          {eventName} has no unplayed quals in the cache, so there is nothing left to plan. The seed
          order above is the finished one.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <span className="eyebrow">BEST PATH</span>
      <h2>What-if the rest of quals</h2>
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
          <article>
            <span>Projected RP</span>
            <strong>{ours ? ours.projectedRankingPoints : "—"}</strong>
            <small>{ours ? `${ours.rankingPoints} banked` : "no standings row"}</small>
          </article>
          <article>
            <span>Forced results</span>
            <strong>{forcedCount}</strong>
            <small>{projection.decidedMatches} of {whatIf.remaining.length} decided</small>
          </article>
          <article>
            <span>Undecided</span>
            <strong>{projection.undecidedMatches}</strong>
            <small>no prediction, not forced</small>
          </article>
        </section>

        <ul className="bp-caveats">
          <li>Ranking points: {whatIf.rules.label}.</li>
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
                      : "No prediction — a robot here has no cached rating"}
                    {forced
                      ? ` · forced ${forced === "tie" ? "tie" : `${forced} wins`}`
                      : effective == null
                        ? " · counts for nobody until you set it"
                        : ""}
                  </span>
                </div>
                <div className="bp-toggle" role="group" aria-label={`Outcome for qualification ${match.matchNumber}`}>
                  <button
                    type="button"
                    aria-pressed={forced == null}
                    onClick={() => setOutcome(match.matchKey, null)}
                  >
                    Predicted
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
                <th scope="col">Proj RP</th>
                <th scope="col">Now</th>
                <th scope="col">Undecided</th>
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

export default function RankingProjectionClient() {
  const [view, setView] = useState<RankingProjectionView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
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
          setError("Could not refresh Rank projection. Showing the last copy on this device.");
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
        setError("Could not refresh Rank projection. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
            {" / Rank projection"}
          </>
        }
        title="Rank projection"
        description="Current official rank plus remaining qualification matches from the cache."
      />
      <OfflineBanner feature="Rank projection" fromCache={fromCache} cachedAt={cachedAt} />
      {error && view ? <p className="app-muted">{error}</p> : null}
      {!view ? (
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Rank projection"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
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
          title="Rankings are not ready"
          description={view.message}
        />
      ) : null}
      {view?.status === "live" ? (
        <>
          <Panel>
            <p>
              {view.eventName} · rank {view.currentRank} · {view.record ?? "no record yet"}
            </p>
            <p>
              {view.playedQuals} quals played, {view.remainingQuals} remaining
              {view.epaTotal != null ? ` · Rating ${view.epaTotal}` : ""}
            </p>
            <p>
              <Button as="a" variant="secondary" href={withOrgHref("/rankings", view.orgId)}>
                Open Rankings
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
                "The cached standings and remaining schedule for this event are not complete enough to project a seed."
              }
            />
          )}
        </>
      ) : null}
    </main>
  );
}
