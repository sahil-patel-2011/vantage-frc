"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { plainStrategyText, readablePlanChip } from "../../lib/briefing/plain-text";
import { ourSideRange } from "../../lib/strategy/our-side-range";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState } from "../../components/ui";
import { briefingChecklist, matchLabel, type BriefingPrediction } from "../../lib/briefing";
import { buildOpponentCards } from "../../lib/briefing/opponent-cards";
import { capabilityLabel } from "../../lib/briefing/plan-sections";
import { briefingPartnerSyncHref, briefingSetupAction } from "../../lib/briefing/setup-action";
import { briefingWinProbability, includeStoredBriefingSections } from "../../lib/briefing/stored-sections";
import type { BriefingScoutedTeam, FullBriefingView } from "../../lib/briefing/types";
import type { MatchCopilotTeam } from "../../lib/match-copilot/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { fmtMatchTime, stripFrc } from "../../lib/schedule-board";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import {
  formatPredictionWinDisplay,
  predictionWinDisplay,
  type PredictionDisplayInput,
} from "../../lib/strategy/prediction-display";
import { fmtTimestamp } from "../../lib/video-review";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { AddMoreLine, EmptyHint, OpponentCards, Section, withOrg } from "./briefing-parts";

function isFullBriefingView(value: unknown): value is FullBriefingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

async function persistBriefingSnapshot(
  orgHint: string,
  matchHint: string,
  data: FullBriefingView,
): Promise<void> {
  const cacheOrg = data.context.orgId?.trim() || orgHint;
  if (!cacheOrg) return;
  const matchKey = data.status === "ready" ? data.match.matchKey : matchHint;
  try {
    await putFeatureSnapshot("briefing", cacheOrg, data, matchKey);
    await putFeatureSnapshot("briefing", cacheOrg, data);
    if (!orgHint) {
      await putFeatureSnapshot("briefing", "_", data, matchKey);
      await putFeatureSnapshot("briefing", "_", data);
    }
  } catch {
    // Live briefing already painted; IndexedDB is best-effort.
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Honest win-% input for the hero tile. DEMO / missing prediction → null (blank). */
function briefingWinDisplayInput(
  prediction: BriefingPrediction | null,
  alliance: "red" | "blue" | null,
): PredictionDisplayInput | null {
  if (!prediction) return null;
  return {
    pRed: prediction.pRed,
    pBlue: prediction.pBlue,
    alliance,
    modelVersion: prediction.modelVersion,
    caveats: prediction.caveats,
  };
}

function fmtSeconds(value: number | null): string {
  return value == null ? "—" : `${value}s`;
}

function fmtRate(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

function fmtEpa(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

/** One scouted-capability row: "254 · 7 entries · auto strong · endgame developing". */
function ScoutedRow({ row }: { row: BriefingScoutedTeam }) {
  const caps: Array<[string, number | null]> = [
    ["auto", row.autoCapability],
    ["teleop", row.teleopCapability],
    ["endgame", row.endgameCapability],
  ];
  return (
    <li>
      <p className="brief-review-head">
        <b>{stripFrc(row.teamKey)}</b>
        <span className="brief-chip">
          {row.scoutSample} {row.scoutSample === 1 ? "entry" : "entries"}
        </span>
        {caps.map(([name, value]) => {
          const label = capabilityLabel(value);
          return label && label !== "not shown" ? (
            <span key={name} className={`brief-chip ${label === "strong" ? "positive" : ""}`}>
              {name} {label}
            </span>
          ) : null;
        })}
        {row.defenseLikely ? <span className="brief-chip critical">plays defense</span> : null}
        {row.foulRate != null && row.foulRate >= 0.5 ? (
          <span className="brief-chip critical">fouls {row.foulRate.toFixed(1)}/match</span>
        ) : null}
      </p>
      {row.pitNotes.length > 0 ? <p className="app-muted brief-no-notes">{row.pitNotes.join(" · ")}</p> : null}
    </li>
  );
}

/** Rating line for a lineup, rendered only when a team has any real metric. */
function EpaList({ teams }: { teams: MatchCopilotTeam[] }) {
  const withData = teams.filter((team) => team.epaTotal != null || team.rank != null);
  if (!withData.length) return null;
  return (
    <ul className="brief-epa-list">
      {withData.map((team) => (
        <li key={team.teamKey}>
          <b>{team.teamNumber || stripFrc(team.teamKey)}</b>
          {team.nickname && team.nickname !== `Team ${team.teamNumber || stripFrc(team.teamKey)}` ? (
            <span className="brief-epa-nick">{team.nickname}</span>
          ) : null}
          <span className="brief-chip">Rating {fmtEpa(team.epaTotal)}</span>
          {team.rank != null ? <span className="brief-chip">rank {team.rank}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export default function BriefingClient() {
  const [view, setView] = useState<FullBriefingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const viewRef = useRef<FullBriefingView | null>(null);
  viewRef.current = view;

  const load = useCallback(async (matchKey: string | null, options?: { refresh?: boolean }) => {
    selectedRef.current = matchKey;
    const pageParams = new URLSearchParams(window.location.search);
    const urlOrg = pageParams.get("orgId")?.trim() ?? "";
    const matchHint = matchKey?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<FullBriefingView>(
        "briefing",
        urlOrg || "_",
        matchHint,
      );
      if (!viewRef.current && cached?.data && isFullBriefingView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (matchHint) query.set("matchKey", matchHint);
    if (options?.refresh) query.set("refresh", "1");
    const suffix = query.toString();
    try {
      const response = await fetch(`/api/briefing${suffix ? `?${suffix}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as FullBriefingView | { error?: string };
      if (!response.ok || !isFullBriefingView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pre-match briefing. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load the pre-match briefing.");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setError("");
      setErrorStatus(null);
      setFetchFailed(false);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistBriefingSnapshot(urlOrg, matchHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Pre-match briefing. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setErrorStatus(null);
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    const pageParams = new URLSearchParams(window.location.search);
    // Canonical param is matchKey; redirected pre-match pages may pass ?match=.
    selectedRef.current = pageParams.get("matchKey") ?? pageParams.get("match");
    void load(selectedRef.current);
    // Background tabs skip the minute refresh (it used to keep hitting the
    // briefing API all day); coming back to the tab refreshes at once.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load(selectedRef.current);
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(selectedRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  if (!view) {
    return (
      <main className="module-page brief-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Briefing</span>
            <h1>Pre-match briefing</h1>
          </div>
        </header>
        <OfflineBanner feature="Pre-match briefing" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card brief-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
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
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <Button as="a" variant="primary" href={copy.primary.href}>
                      {copy.primary.label}
                    </Button>
                  ) : null}
                  {copy.showRetry ? (
                    <Button variant="secondary" type="button" onClick={() => void load(selectedRef.current)}>
                      Retry
                    </Button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading pre-match briefing…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupAction = briefingSetupAction(view.context);
    return (
      <main className="module-page brief-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Briefing</span>
            <h1>Pre-match briefing</h1>
            <p>One briefing per match — prediction, plan, opponent notes, scouted tendencies, and film.</p>
          </div>
        </header>
        <OfflineBanner feature="Pre-match briefing" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState soft badge="Needs setup" badgeTone="setup" title={view.message}>
          <Button as="a" variant="primary" href={setupAction.href}>
            {setupAction.label}
          </Button>
        </EmptyState>
      </main>
    );
  }

  const orgId = view.context.orgId;
  const partnerSyncHref = briefingPartnerSyncHref(orgId, view.context.role);
  const teamKey = view.context.teamNumber != null ? `frc${view.context.teamNumber}` : null;
  const side = view.ourAlliance;
  const ourKeys = side === "red" ? view.match.red : side === "blue" ? view.match.blue : [];
  const oppKeys = side === "red" ? view.match.blue : side === "blue" ? view.match.red : [];
  const partners = ourKeys.filter((key) => key !== teamKey).map(stripFrc);
  const opponents = oppKeys.map(stripFrc);
  const prob = briefingWinProbability(view.prediction, side);
  const winInput = briefingWinDisplayInput(view.prediction, side);
  const winDisplay = predictionWinDisplay(winInput);
  const winPct = formatPredictionWinDisplay(winInput);
  const ourRange = ourSideRange(view.prediction?.confidenceLow, view.prediction?.confidenceHigh, side);
  const stored = includeStoredBriefingSections({
    card: view.card,
    counterBooks: view.counterBooks,
    watchNotes: view.watchNotes,
    defensePlans: view.defensePlans,
  });
  const checklist = briefingChecklist({
    hasPrediction: prob != null,
    hasPlan: view.plan != null,
    hasPlay: view.play != null,
    practiceReps: view.practice.reps,
    intelCount: view.opponentIntel.length,
    scoutCount: view.scoutCount,
    hasCard: stored.included.includes("card"),
    hasCounterBooks: stored.included.includes("counterBooks"),
    hasWatchNotes: stored.included.includes("watchNotes"),
    hasDefensePlans: stored.included.includes("defensePlans"),
  });
  const showCard = stored.included.includes("card");
  const showWatchNotes = stored.included.includes("watchNotes");
  const showCounterBooks = stored.included.includes("counterBooks");
  const showDefensePlans = stored.included.includes("defensePlans");

  const batteryCritical = view.batteries.filter((battery) => battery.flag === "critical");
  const batteryWatch = view.batteries.filter((battery) => battery.flag === "watch");
  const opponentCards = buildOpponentCards({
    opponentKeys: oppKeys,
    opponentTeams: view.opponentTeams,
    scouted: view.opponentsScouted,
    tendencies: view.tendencies,
    watchNotes: showWatchNotes ? view.watchNotes : [],
    counterBooks: showCounterBooks ? view.counterBooks : [],
    defensePlans: showDefensePlans ? view.defensePlans : [],
  });
  // Chips like "match Qual 30" or "red without that match 67" are engine notes, not advice.
  const readable = (list: string[]) => list.map(readablePlanChip).filter((entry): entry is string => Boolean(entry));
  const planChips = {
    strengths: readable(view.plan?.strengths ?? []),
    risks: readable(view.plan?.risks ?? []),
    checkpoints: readable(view.plan?.checkpoints ?? []),
  };
  const opponentEvidence = opponentCards.flatMap((card) => card.evidence);
  const factors = view.prediction?.keyFactors.slice(0, 3) ?? [];
  const caveats = view.prediction?.caveats ?? [];
  const hasRobotHealth = view.pitReports.length > 0 || view.openRisks.length > 0 || view.batteries.length > 0;

  return (
    <main className="module-page brief-page">
      {/* Title and match picker on one line; Refresh / Recompute / Print behind one menu (the
          page refreshes itself every minute), so the match starts at the top of the screen. */}
      <header className="app-page-header brief-head">
        <div>
          <span className="breadcrumbs">Competition / Briefing</span>
          <div className="brief-title-row">
            <h1>Pre-match briefing</h1>
            <label className="brief-picker">
              <span className="visually-hidden">Match</span>
              <select aria-label="Match" value={view.match.matchKey} onChange={(event) => void load(event.target.value)}>
                {view.ourMatches.map((entry) => (
                  <option key={entry.matchKey} value={entry.matchKey}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <details className="brief-more">
              <summary aria-label="More briefing actions">⋯</summary>
              <div className="brief-more-menu">
                <button type="button" onClick={() => void load(selectedRef.current)}>
                  Refresh now
                </button>
                <button type="button" onClick={() => void load(selectedRef.current, { refresh: true })}>
                  Recompute prediction
                </button>
                <button type="button" onClick={() => window.print()}>
                  Print
                </button>
              </div>
            </details>
          </div>
          <p>
            {scoutEventLabel({ eventName: view.context.eventName, eventKey: view.context.eventKey })}
            {view.context.teamNumber != null ? ` — Team ${view.context.teamNumber}` : ""}
          </p>
        </div>
      </header>
      <OfflineBanner feature="Pre-match briefing" fromCache={fromCache} cachedAt={cachedAt} />

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded briefing."}
        </p>
      ) : null}

      <section className="brief-hero">
        <div className="brief-hero-main">
          <span className="brief-hero-kicker">{view.match.played ? "Played: looking back" : "Up next for the drive team"}</span>
          <strong className="brief-hero-match">{matchLabel(view.match.compLevel, view.match.matchNumber)}</strong>
          <span className="brief-hero-sub">{fmtMatchTime(view.match.scheduledTime) || "Time TBD"}</span>
          <div className="brief-hero-teams">
            {side ? <span className={`brief-alliance-chip ${side}`}>{side === "red" ? "Red alliance" : "Blue alliance"}</span> : null}
            <span className="brief-hero-lineup">
              With {partners.length ? partners.join(" · ") : "—"}
              <em> vs {opponents.length ? opponents.join(" · ") : "—"}</em>
            </span>
            <span className="brief-chip">
              {view.scoutCount > 0
                ? `${view.scoutCount} ${view.scoutCount === 1 ? "scout" : "scouts"} assigned`
                : "No scouts assigned"}
            </span>
            {view.ourEpaTotal != null ? <span className="brief-chip">our rating {fmtEpa(view.ourEpaTotal)}</span> : null}
          </div>
        </div>
        {winDisplay && view.prediction ? (
          <div className="brief-prob">
            <span className="brief-prob-num">{winPct ?? ""}</span>
            <span className="brief-prob-label">chance to win</span>
            {ourRange ? (
              <span className="brief-prob-range">
                typical range {pct(ourRange.low)}–{pct(ourRange.high)}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="brief-prob none">
            <span className="brief-prob-label">No grounded prediction yet</span>
            <a href={withOrg("/strategy", orgId)}>Run Strategy</a>
            <Button variant="secondary" type="button" onClick={() => void load(selectedRef.current, { refresh: true })}>
              Recompute prediction
            </Button>
          </div>
        )}
      </section>

      {view.callouts.length > 0 ? (
        <section className="app-card brief-callouts">
          <h2>Do this next</h2>
          <ol>
            {view.callouts.map((callout) => (
              <li key={`${callout.priority}-${callout.headline}`}>
                <b>{plainStrategyText(callout.headline)}</b>
                {callout.detail ? <span> — {plainStrategyText(callout.detail)}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="app-card brief-opponents" aria-labelledby="brief-opp-title">
        <h2 id="brief-opp-title">Opponents{opponents.length ? `: ${opponents.join(" · ")}` : ""}</h2>
        {opponentCards.length ? (
          <OpponentCards cards={opponentCards} orgId={orgId} />
        ) : (
          <EmptyHint>We don&rsquo;t know our colour for this match yet, so opponents aren&rsquo;t listed.</EmptyHint>
        )}
      </section>

      {factors.length > 0 || caveats.length > 0 || opponentEvidence.length > 0 ? (
        <details className="app-card brief-why">
          <summary>How we got this</summary>
          {factors.length > 0 ? (
            <ul className="brief-factors">
              {factors.map((factor, index) => (
                <li key={`${factor.name}-${index}`}>
                  <b>{plainStrategyText(factor.name)}</b>
                  {factor.evidence ? <span> — {plainStrategyText(factor.evidence)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {caveats.length > 0 ? (
            <p className="brief-caveats">Caveats: {caveats.map(plainStrategyText).join(" · ")}</p>
          ) : null}
          {opponentEvidence.length > 0 ? (
            <>
              <h3 className="brief-why-head">Opponent scouting behind the cards</h3>
              <ul className="brief-factors">
                {opponentEvidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </details>
      ) : null}

      <div className="brief-grid">
        {showCard && view.card ? (
        <Section title="Match card" badge={showCard && view.card?.updatedAt ? "saved" : null}>
          {showCard && view.card ? (
            <>
              {view.card.gamePlan ? <p className="brief-plan-title">{view.card.gamePlan}</p> : null}
              <dl className="brief-card-fields">
                {view.card.autoAssignment ? (
                  <div>
                    <dt>Auto</dt>
                    <dd>{view.card.autoAssignment}</dd>
                  </div>
                ) : null}
                {view.card.defenseFocus ? (
                  <div>
                    <dt>Defense</dt>
                    <dd>{view.card.defenseFocus}</dd>
                  </div>
                ) : null}
                {view.card.keyThreats ? (
                  <div>
                    <dt>Threats</dt>
                    <dd>{view.card.keyThreats}</dd>
                  </div>
                ) : null}
                {view.card.driverNotes ? (
                  <div>
                    <dt>Driver notes</dt>
                    <dd>{view.card.driverNotes}</dd>
                  </div>
                ) : null}
              </dl>
              {view.card.roleAssignments.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Roles</span>
                  {view.card.roleAssignments.map((entry, index) => (
                    <span key={`${index}-${entry.role}`} className="brief-chip">
                      {entry.role ? `${entry.role}: ` : ""}
                      {entry.assignee}
                    </span>
                  ))}
                </div>
              ) : null}
              <a href={withOrg("/match-strategy-cards", orgId)}>Edit in Match cards</a>
            </>
          ) : null}
        </Section>
        ) : null}

        <Section title="Game plan">
          {view.plan ? (
            <>
              {view.plan.title ? <p className="brief-plan-title">{plainStrategyText(view.plan.title)}</p> : null}
              {view.plan.priorities.length > 0 ? (
                <ol className="brief-priorities">
                  {view.plan.priorities.map((priority, index) => (
                    <li key={`${index}-${priority}`}>{plainStrategyText(priority)}</li>
                  ))}
                </ol>
              ) : null}
              {planChips.strengths.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Protect</span>
                  {planChips.strengths.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip positive">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {planChips.risks.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Watch out</span>
                  {planChips.risks.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip critical">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {planChips.checkpoints.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Checkpoints</span>
                  {planChips.checkpoints.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyHint>
              No game plan for this match yet. <a href={withOrg("/strategy", orgId)}>Open Strategy</a> to make one.
            </EmptyHint>
          )}
        </Section>

        <Section
          title="Our alliance — scouted"
          badge={view.alliesScouted.length ? `${view.alliesScouted.length} robots` : null}
        >
          {view.alliesScouted.length > 0 || view.allyTeams.some((team) => team.epaTotal != null || team.rank != null) ? (
            <>
              <EpaList teams={view.allyTeams} />
              {view.alliesScouted.length > 0 ? (
                <ul className="brief-reviews">
                  {view.alliesScouted.map((row) => (
                    <ScoutedRow key={row.teamKey} row={row} />
                  ))}
                </ul>
              ) : (
                <EmptyHint>
                  No scout entries for our alliance yet —{" "}
                  <a href={withOrg("/scouting", orgId)}>scout partners in Scouting</a>
                </EmptyHint>
              )}
            </>
          ) : (
            <EmptyHint>
              No partner data yet — <a href={withOrg("/scouting", orgId)}>scout partners in Scouting</a>{partnerSyncHref ? (
                <>
                  {" or sync ratings in "}
                  <a href={partnerSyncHref}>Team Data</a>
                </>
              ) : (
                ". An owner or admin syncs ratings."
              )}
            </EmptyHint>
          )}
        </Section>

        {view.play ? (
        <Section title="Linked whiteboard play">
          {view.play ? (
            <>
              <p className="brief-play-title">{plainStrategyText(view.play.title)}</p>
              {view.play.description ? <p className="app-muted brief-play-desc">{view.play.description}</p> : null}
              <p className="brief-play-meta">
                <span className="brief-chip">
                  {view.play.strokeCount} {view.play.strokeCount === 1 ? "stroke" : "strokes"}
                </span>
                <a href={withOrg("/whiteboard", orgId)}>Open in Whiteboard</a>
              </p>
            </>
          ) : null}
        </Section>
        ) : null}

        {view.practice.reps > 0 ? (
        <Section title="Drive-team readiness">
          {view.practice.reps > 0 ? (
            <>
              <div className="brief-stats">
                <div className="brief-stat">
                  <b>{view.practice.reps}</b>
                  <span>reps logged</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtRate(view.practice.successRate)}</b>
                  <span>success</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtSeconds(view.practice.avgSeconds)}</b>
                  <span>avg cycle</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtSeconds(view.practice.bestSeconds)}</b>
                  <span>best cycle</span>
                </div>
              </div>
              {view.practice.topActions.length > 0 ? (
                <table className="brief-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Reps</th>
                      <th>Success</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.practice.topActions.map((entry) => (
                      <tr key={entry.action}>
                        <td>{entry.action}</td>
                        <td>{entry.reps}</td>
                        <td>{fmtRate(entry.successRate)}</td>
                        <td>{fmtSeconds(entry.avgSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : null}
        </Section>
        ) : null}

        {view.opponentIntel.length > 0 ? (
        <Section title="Opponent film">
          {view.opponentIntel.length > 0 ? (
            <ul className="brief-reviews">
              {view.opponentIntel.map((intel, index) => (
                <li key={`${intel.reviewTitle}-${index}`}>
                  <p className="brief-review-head">
                    <b>{intel.reviewTitle}</b>
                    {intel.teamKey ? <span className="brief-chip">{stripFrc(intel.teamKey)}</span> : null}
                  </p>
                  {intel.notes.length > 0 ? (
                    <ul className="brief-notes">
                      {intel.notes.map((note, noteIndex) => (
                        <li key={`${note.atSeconds}-${noteIndex}`}>
                          <span className="brief-ts">{fmtTimestamp(note.atSeconds)}</span>
                          <i className="brief-tag">{note.tag}</i>
                          <span className="brief-note-body">{note.body}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="app-muted brief-no-notes">No timestamped notes yet.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {view.opponentIntel.length > 0 ? <a href={withOrg("/video", orgId)}>Open Video Review</a> : null}
        </Section>
        ) : null}

        <Section
          title="Our robot"
          badge={
            view.pitReports.length > 0
              ? `${view.pitReports.length} open ${view.pitReports.length === 1 ? "repair" : "repairs"}`
              : batteryCritical.length > 0
                ? `${batteryCritical.length} critical ${batteryCritical.length === 1 ? "battery" : "batteries"}`
                : null
          }
        >
          {hasRobotHealth ? (
            <>
              {view.pitReports.length > 0 ? (
                <div className="brief-subblock">
                  <h3>Pit repairs</h3>
                  <ul className="brief-notes">
                    {view.pitReports.map((report) => (
                      <li key={report.id}>
                        <i className="brief-tag">{report.status}</i>
                        <span className="brief-note-body">
                          <b>{report.subsystemName}</b> — {report.title} ({report.decision}
                          {report.prestageRecommended ? ", pre-stage spare" : ""})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <a href={withOrg("/pit-repair-triage", orgId)}>Open Repair triage</a>
                </div>
              ) : null}
              {view.openRisks.length > 0 ? (
                <div className="brief-subblock">
                  <h3>Open robot risks</h3>
                  <ul className="brief-notes">
                    {view.openRisks.slice(0, 4).map((risk) => (
                      <li key={risk.id}>
                        <i className="brief-tag">risk {risk.rpn}</i>
                        <span className="brief-note-body">
                          <b>{risk.subsystemName}</b> — {risk.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <a href={withOrg("/fmea", orgId)}>Open robot risks</a>
                </div>
              ) : null}
              {view.batteries.length > 0 ? (
                <div className="brief-subblock">
                  <h3>Batteries</h3>
                  <p className="brief-chip-row">
                    <span className="brief-chip positive">
                      {view.batteries.length - batteryWatch.length - batteryCritical.length} healthy
                    </span>
                    {batteryWatch.length > 0 ? <span className="brief-chip">{batteryWatch.length} watch</span> : null}
                    {batteryCritical.length > 0 ? (
                      <span className="brief-chip critical">
                        {batteryCritical.length} critical: {batteryCritical.map((battery) => battery.label).join(", ")}
                      </span>
                    ) : null}
                  </p>
                  <a href={withOrg("/battery-rotation", orgId)}>Open Charge plan</a>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyHint>
              No robot problems logged. <a href={withOrg("/pit-repair-triage", orgId)}>Log a repair</a>, note{" "}
              <a href={withOrg("/fmea", orgId)}>robot risks</a>, or check <a href={withOrg("/batteries", orgId)}>batteries</a>.
            </EmptyHint>
          )}
        </Section>
      </div>

      <AddMoreLine rows={checklist} orgId={orgId} />
    </main>
  );
}
