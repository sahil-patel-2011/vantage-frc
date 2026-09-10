"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  briefingChecklist,
  matchLabel,
  type BriefingChecklistRow,
  type BriefingPrediction,
} from "../../lib/briefing";
import { capabilityLabel } from "../../lib/briefing/plan-sections";
import { briefingWinProbability, includeStoredBriefingSections } from "../../lib/briefing/stored-sections";
import type { BriefingScoutedTeam, FullBriefingView } from "../../lib/briefing/types";
import type { MatchCopilotTeam } from "../../lib/match-copilot/types";
import { fmtMatchTime, stripFrc } from "../../lib/schedule-board";
import {
  formatPredictionWinDisplay,
  predictionWinDisplay,
  type PredictionDisplayInput,
} from "../../lib/strategy/prediction-display";
import { fmtTimestamp } from "../../lib/video-review";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

/** Where each checklist row sends the coach to fix the gap. */
const CHECKLIST_HREFS: Record<string, string> = {
  Prediction: "/strategy",
  "Strategy plan": "/strategy",
  "Match card": "/match-strategy-cards",
  "Counter-book": "/counter-book",
  Watchlist: "/opponent-watchlist",
  "Defense plan": "/defense-planner",
  "Whiteboard play": "/whiteboard",
  "Practice data": "/practice",
  "Opponent video": "/video",
};

function withOrg(href: string, orgId: string | null): string {
  return orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href;
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

/** Inline "not available — do X" hint reused by the checklist and each empty section. */
function MissingHint({ row, orgId }: { row: BriefingChecklistRow | undefined; orgId: string | null }) {
  if (!row) return null;
  const href = CHECKLIST_HREFS[row.label] ?? "/workspace";
  return (
    <p className="brief-missing">
      <span className="brief-mark no" aria-hidden="true">
        ✗
      </span>
      Not available — <a href={withOrg(href, orgId)}>{row.hint}</a>
    </p>
  );
}

/** Honest empty state for a consolidated section, with the exact setup step. */
function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="brief-missing">
      <span className="brief-mark no" aria-hidden="true">
        ✗
      </span>
      {children}
    </p>
  );
}

/** Collapsible section — one scrollable card the coach reads top-to-bottom.
 * Everything defaults open; collapsing is for skipping past on a phone. */
function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string | null;
  children: ReactNode;
}) {
  return (
    <details className="app-card brief-section" open>
      <summary>
        <h2>{title}</h2>
        {badge ? <span className="brief-chip">{badge}</span> : null}
        <span className="brief-section-caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="brief-section-body">{children}</div>
    </details>
  );
}

function ChecklistCard({ rows, orgId }: { rows: BriefingChecklistRow[]; orgId: string | null }) {
  const ready = rows.filter((row) => row.ok).length;
  return (
    <section className="app-card brief-checklist">
      <h2>
        Briefing readiness
        <span className="brief-checklist-count">
          {ready}/{rows.length} ready
        </span>
      </h2>
      <ul>
        {rows.map((row) => (
          <li key={row.label} className={row.ok ? "ok" : "no"}>
            <span className={row.ok ? "brief-mark ok" : "brief-mark no"} aria-hidden="true">
              {row.ok ? "✓" : "✗"}
            </span>
            <b>{row.label}</b>
            {row.ok ? null : <a href={withOrg(CHECKLIST_HREFS[row.label] ?? "/workspace", orgId)}>{row.hint}</a>}
          </li>
        ))}
      </ul>
    </section>
  );
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

/** EPA line for a lineup, rendered only when a team has any real metric. */
function EpaList({ teams }: { teams: MatchCopilotTeam[] }) {
  const withData = teams.filter((team) => team.epaTotal != null || team.rank != null);
  if (!withData.length) return null;
  return (
    <ul className="brief-epa-list">
      {withData.map((team) => (
        <li key={team.teamKey}>
          <b>{team.teamNumber || stripFrc(team.teamKey)}</b>
          {team.nickname ? <span className="brief-epa-nick">{team.nickname}</span> : null}
          <span className="brief-chip">EPA {fmtEpa(team.epaTotal)}</span>
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
  const selectedRef = useRef<string | null>(null);

  const load = useCallback(async (matchKey: string | null, options?: { refresh?: boolean }) => {
    selectedRef.current = matchKey;
    const pageParams = new URLSearchParams(window.location.search);
    const orgId = pageParams.get("orgId");
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    if (matchKey) query.set("matchKey", matchKey);
    if (options?.refresh) query.set("refresh", "1");
    const suffix = query.toString();
    try {
      const response = await fetch(`/api/briefing${suffix ? `?${suffix}` : ""}`);
      const data = (await response.json()) as FullBriefingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the pre-match briefing.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setFetchFailed(false);
      setView(data);
    } catch {
      setErrorStatus(null);
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    const pageParams = new URLSearchParams(window.location.search);
    // Canonical param is matchKey; redirected pre-match pages may pass ?match=.
    selectedRef.current = pageParams.get("matchKey") ?? pageParams.get("match");
    void load(selectedRef.current);
    const timer = window.setInterval(() => {
      void load(selectedRef.current);
    }, 60_000);
    return () => window.clearInterval(timer);
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
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current)}>
                      Retry
                    </button>
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
    return (
      <main className="module-page brief-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Briefing</span>
            <h1>Pre-match briefing</h1>
            <p>One briefing per match — prediction, plan, opponent notes, scouted tendencies, and film.</p>
          </div>
        </header>
        <div className="app-card brief-empty">
          <strong>Almost there</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId;
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
  const rowFor = (label: string) => checklist.find((row) => row.label === label);
  const showCard = stored.included.includes("card");
  const showWatchNotes = stored.included.includes("watchNotes");
  const showCounterBooks = stored.included.includes("counterBooks");
  const showDefensePlans = stored.included.includes("defensePlans");

  const batteryCritical = view.batteries.filter((battery) => battery.flag === "critical");
  const batteryWatch = view.batteries.filter((battery) => battery.flag === "watch");
  const hasTbaOpponentMetrics = view.opponentTeams.some((team) => team.epaTotal != null || team.rank != null);
  const hasOpponentNotes =
    view.opponentsScouted.length > 0 ||
    view.tendencies.length > 0 ||
    showCounterBooks ||
    showWatchNotes ||
    showDefensePlans ||
    hasTbaOpponentMetrics;
  const hasRobotHealth = view.pitReports.length > 0 || view.openRisks.length > 0 || view.batteries.length > 0;

  return (
    <main className="module-page brief-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Briefing</span>
          <h1>Pre-match briefing</h1>
          <p>
            {view.context.eventName ?? view.context.eventKey}
            {view.context.teamNumber != null ? ` — Team ${view.context.teamNumber}` : ""}
          </p>
        </div>
        <div className="brief-controls">
          <label className="brief-picker">
            <span>Match</span>
            <select value={view.match.matchKey} onChange={(event) => void load(event.target.value)}>
              {view.ourMatches.map((entry) => (
                <option key={entry.matchKey} value={entry.matchKey}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current)}>
            Refresh
          </button>
          <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current, { refresh: true })}>
            Recompute prediction
          </button>
          <button type="button" className="app-button secondary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded briefing."}
        </p>
      ) : null}

      <section className="brief-hero">
        <div className="brief-hero-main">
          <span className="brief-hero-kicker">Up next for the drive team</span>
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
            {view.ourEpaTotal != null ? <span className="brief-chip">our EPA {fmtEpa(view.ourEpaTotal)}</span> : null}
          </div>
        </div>
        {winDisplay && view.prediction ? (
          <div className="brief-prob">
            <span className="brief-prob-num">{winPct ?? ""}</span>
            <span className="brief-prob-label">win probability</span>
            <span className="brief-prob-range">
              confidence {pct(view.prediction.confidenceLow)}–{pct(view.prediction.confidenceHigh)} ·{" "}
              {view.prediction.modelVersion}
            </span>
          </div>
        ) : (
          <div className="brief-prob none">
            <span className="brief-prob-label">No grounded prediction yet</span>
            <a href={withOrg("/strategy", orgId)}>Run Strategy</a>
            <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current, { refresh: true })}>
              Recompute prediction
            </button>
          </div>
        )}
      </section>

      {view.callouts.length > 0 ? (
        <section className="app-card brief-callouts">
          <h2>Do this next</h2>
          <ol>
            {view.callouts.map((callout) => (
              <li key={`${callout.priority}-${callout.headline}`}>
                <b>{callout.headline}</b>
                {callout.detail ? <span> — {callout.detail}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.prediction && (view.prediction.keyFactors.length > 0 || view.prediction.caveats.length > 0) ? (
        <section className="app-card brief-why">
          {view.prediction.keyFactors.length > 0 ? (
            <ul className="brief-factors">
              {view.prediction.keyFactors.slice(0, 3).map((factor, index) => (
                <li key={`${factor.name}-${index}`}>
                  <b>{factor.name}</b>
                  {factor.evidence ? <span> — {factor.evidence}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {view.prediction.caveats.length > 0 ? (
            <p className="brief-caveats">Caveats: {view.prediction.caveats.join(" · ")}</p>
          ) : null}
        </section>
      ) : null}

      <ChecklistCard rows={checklist} orgId={orgId} />

      <div className="brief-grid">
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
          ) : (
            <EmptyHint>
              No card for this match — <a href={withOrg("/match-strategy-cards", orgId)}>write one in Match cards</a>
            </EmptyHint>
          )}
        </Section>

        <Section title="Game plan">
          {view.plan ? (
            <>
              {view.plan.title ? <p className="brief-plan-title">{view.plan.title}</p> : null}
              {view.plan.priorities.length > 0 ? (
                <ol className="brief-priorities">
                  {view.plan.priorities.map((priority, index) => (
                    <li key={`${index}-${priority}`}>{priority}</li>
                  ))}
                </ol>
              ) : null}
              {view.plan.strengths.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Protect</span>
                  {view.plan.strengths.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip positive">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {view.plan.risks.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Mitigate</span>
                  {view.plan.risks.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip critical">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {view.plan.checkpoints.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Checkpoints</span>
                  {view.plan.checkpoints.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <MissingHint row={rowFor("Strategy plan")} orgId={orgId} />
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
              No partner data yet — <a href={withOrg("/scouting", orgId)}>scout partners in Scouting</a> or sync EPA in{" "}
              <a href={withOrg("/team/data", orgId)}>Team → Data</a>
            </EmptyHint>
          )}
        </Section>

        <Section title="Opponents" badge={opponents.length ? opponents.join(" · ") : null}>
          {hasOpponentNotes ? (
            <>
              <EpaList teams={view.opponentTeams} />
              {view.opponentsScouted.length > 0 ? (
                <ul className="brief-reviews">
                  {view.opponentsScouted.map((row) => (
                    <ScoutedRow key={row.teamKey} row={row} />
                  ))}
                </ul>
              ) : null}
              {view.tendencies.length > 0 ? (
                <ul className="brief-tendencies">
                  {view.tendencies.map((tendency) => (
                    <li key={tendency.teamKey}>
                      <p className="brief-review-head">
                        <b>{stripFrc(tendency.teamKey)}</b>
                        {tendency.labels.map((label) => (
                          <span key={label} className="brief-chip">
                            {label}
                          </span>
                        ))}
                      </p>
                      {tendency.evidence.length > 0 ? (
                        <p className="app-muted brief-no-notes">{tendency.evidence.join(" ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {showWatchNotes ? (
                <div className="brief-subblock">
                  <h3>Watchlist notes</h3>
                  <ul className="brief-notes">
                    {view.watchNotes.map((note, index) => (
                      <li key={`${note.teamKey}-${index}`}>
                        <i className="brief-tag">{note.teamNumber ?? stripFrc(note.teamKey)}</i>
                        <span className="brief-note-body">{note.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyHint>
                  No watchlist notes for these opponents —{" "}
                  <a href={withOrg("/opponent-watchlist", orgId)}>add one on Watchlist</a>
                </EmptyHint>
              )}
              {showCounterBooks ? (
                <div className="brief-subblock">
                  <h3>Counter-books</h3>
                  <ul className="brief-notes">
                    {view.counterBooks.map((book) => (
                      <li key={book.id}>
                        <i className="brief-tag">{book.teamNumber ?? stripFrc(book.teamKey)}</i>
                        <span className="brief-note-body">
                          <b>{book.counterPlan || book.summary}</b>
                          {book.tendencies.length > 0 ? (
                            <span className="brief-chip-row">
                              {book.tendencies.map((tendency) => (
                                <span key={tendency.field} className="brief-chip">
                                  {tendency.field} ~{Math.round(tendency.average * 10) / 10} (n=
                                  {tendency.sampleSize})
                                </span>
                              ))}
                            </span>
                          ) : null}
                          {book.failureTriggers.length > 0 ? (
                            <span className="app-muted brief-no-notes">
                              Breaks down: {book.failureTriggers.map((t) => t.detail).join("; ")}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {view.counterBookGaps.length > 0 ? (
                    <p className="app-muted brief-no-notes">
                      No counter-book yet for {view.counterBookGaps.map(stripFrc).join(", ")} —{" "}
                      <a href={withOrg("/counter-book", orgId)}>generate one</a>
                    </p>
                  ) : null}
                </div>
              ) : (
                <EmptyHint>
                  No counter-book yet
                  {oppKeys.length ? ` for ${opponents.join(", ")}` : ""} —{" "}
                  <a href={withOrg("/counter-book", orgId)}>generate one</a>
                </EmptyHint>
              )}
              {showDefensePlans ? (
                <div className="brief-subblock">
                  <h3>Defense plan</h3>
                  <ul className="brief-notes">
                    {view.defensePlans.map((plan) => (
                      <li key={plan.opponentTeamNumber}>
                        <i className="brief-tag">{plan.opponentTeamNumber}</i>
                        <span className="brief-note-body">
                          <b>
                            {plan.recommendation === "play_defense"
                              ? "Play defense"
                              : plan.recommendation === "stay_offense"
                                ? "Stay offense"
                                : "Situational"}
                          </b>
                          {plan.assignedDefender === "us" ? " (we defend)" : ""}
                          {plan.rationale ? ` — ${plan.rationale}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyHint>
                  No defense plan for these opponents —{" "}
                  <a href={withOrg("/defense-planner", orgId)}>plan in Defense</a>
                </EmptyHint>
              )}
            </>
          ) : (
            <EmptyHint>
              Nothing on these opponents yet — <a href={withOrg("/scouting", orgId)}>scout them</a>, add{" "}
              <a href={withOrg("/opponent-watchlist", orgId)}>watchlist notes</a>, generate a{" "}
              <a href={withOrg("/counter-book", orgId)}>counter-book</a>, or plan defense in{" "}
              <a href={withOrg("/defense-planner", orgId)}>Defense</a>
            </EmptyHint>
          )}
        </Section>

        <Section title="Linked whiteboard play">
          {view.play ? (
            <>
              <p className="brief-play-title">{view.play.title}</p>
              {view.play.description ? <p className="app-muted brief-play-desc">{view.play.description}</p> : null}
              <p className="brief-play-meta">
                <span className="brief-chip">
                  {view.play.strokeCount} {view.play.strokeCount === 1 ? "stroke" : "strokes"}
                </span>
                <a href={withOrg("/whiteboard", orgId)}>Open in Whiteboard</a>
              </p>
            </>
          ) : (
            <MissingHint row={rowFor("Whiteboard play")} orgId={orgId} />
          )}
        </Section>

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
          ) : (
            <MissingHint row={rowFor("Practice data")} orgId={orgId} />
          )}
        </Section>

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
          ) : (
            <MissingHint row={rowFor("Opponent video")} orgId={orgId} />
          )}
          {view.opponentIntel.length > 0 ? <a href={withOrg("/video", orgId)}>Open Video Review</a> : null}
        </Section>

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
                  <h3>Open FMEA risks</h3>
                  <ul className="brief-notes">
                    {view.openRisks.slice(0, 4).map((risk) => (
                      <li key={risk.id}>
                        <i className="brief-tag">RPN {risk.rpn}</i>
                        <span className="brief-note-body">
                          <b>{risk.subsystemName}</b> — {risk.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <a href={withOrg("/fmea", orgId)}>Open FMEA</a>
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
              No robot-health data yet — log repairs in{" "}
              <a href={withOrg("/pit-repair-triage", orgId)}>Repair triage</a>, risks in{" "}
              <a href={withOrg("/fmea", orgId)}>FMEA</a>, or batteries in{" "}
              <a href={withOrg("/batteries", orgId)}>Batteries</a>
            </EmptyHint>
          )}
        </Section>
      </div>
    </main>
  );
}
