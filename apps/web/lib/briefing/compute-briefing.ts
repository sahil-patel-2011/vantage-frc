// One Pre-Match Briefing — the consolidated server compute.
//
// This is THE pre-match surface: for one match key it gathers everything real
// that exists across the platform, and nothing that doesn't:
//   - schedule + alliances            matches_ref (TBA reference cache)
//   - prediction + computed playbook  predictions / match_strategies, written by
//                                     computeStrategyView (packages/prediction-strategy).
//                                     When no stored prediction exists yet for the
//                                     selected match, the strategy compute is REUSED
//                                     once (it persists its own rows) — never
//                                     reimplemented here.
//   - our own scouting per robot      match_strategies.plan.operations — the
//                                     scout→strategy form-builder role bridge output
//   - opponent tendencies             match_strategies.plan.tendencies
//   - human-authored match card       match_strategy_cards
//   - opponent watchlist notes        opponent_watchlist_entries
//   - defense plans                   defense_planner_matchups
//   - pit-repair status (our robot)   pit_repair_triage_reports
//   - robot health                    fmea_failures (open) + battery_packs/logs
//   - do-this callouts                match_copilot_briefs (persisted) or the same
//                                     deterministic composer Match Copilot used
//   - practice readiness              driver_sessions/driver_cycles
//   - opponent film                   video_reviews/video_notes
//
// Every section renders only when its data exists; missing data yields honest
// per-section empty states with the exact setup step. RLS scopes every query.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
  matchLabel,
  normalizePlan,
  ourAllianceOf,
  practiceReadiness,
  type BriefingMatch,
  type BriefingPlan,
  type BriefingPrediction,
  type BriefingView,
  type OpponentIntel,
} from "../briefing";
import type { DriverCycle, DriverSession } from "../driver-practice";
import { composeMatchCopilotCallouts } from "../match-copilot";
import {
  loadBatteryFleet,
  loadLatestBrief,
  loadOpenRisks,
  loadTeams,
} from "../match-copilot/compute-match-copilot";
import type { MatchCopilotCallout, MatchCopilotTeam } from "../match-copilot/types";
import { selectBriefingCard, type MatchStrategyCardRow } from "./card-section";
import {
  counterBookGaps as computeCounterBookGaps,
  selectBriefingCounterBooks,
  type CounterBookReportRow,
} from "./counter-book-section";
import {
  selectBriefingDefensePlans,
  type DefensePlannerMatchupRow,
} from "./defense-planner-section";
import {
  normalizePlanOperations,
  normalizePlanTendencies,
  splitScoutedByAlliance,
  teamNumberFromKey,
} from "./plan-sections";
import { refreshBriefingPrediction } from "./refresh-prediction";
import { selectBriefingWatchNotes, type WatchlistEntryRow } from "./watchlist-section";
import type {
  BriefingCard,
  BriefingCounterBook,
  BriefingDefensePlan,
  BriefingPitReport,
  BriefingScoutedTeam,
  BriefingTendency,
  BriefingWatchNote,
  FullBriefingView,
} from "./types";

type AllianceJson = { teamKeys?: unknown; score?: unknown } | null;

function teamKeysOf(alliance: AllianceJson): string[] {
  const keys = alliance?.teamKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => String(key));
}

function allianceScore(alliance: AllianceJson): number | null {
  const score = alliance?.score;
  return score == null ? null : Number(score);
}

/** Defensive narrow of the stored key_factors JSONB into the briefing shape. */
function normalizeKeyFactors(value: unknown): BriefingPrediction["keyFactors"] {
  if (!Array.isArray(value)) return [];
  const factors: BriefingPrediction["keyFactors"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const impact = Number(record.impact);
    factors.push({
      name,
      alliance: typeof record.alliance === "string" ? record.alliance : "",
      impact: Number.isFinite(impact) ? impact : 0,
      evidence: typeof record.evidence === "string" ? record.evidence : "",
    });
  }
  return factors.slice(0, 6);
}

/** Defensive narrow of the stored caveats JSONB into a string array. */
function normalizeCaveats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 8);
}

/** Opponent film: reviews tagged with an opponent team or linked to this match. */
async function loadOpponentIntel(
  client: PoolClient,
  orgId: string,
  matchKey: string,
  opponents: string[],
): Promise<OpponentIntel[]> {
  const reviews = await client.query<{ id: string; title: string; teamKey: string | null }>(
    `SELECT r.id, r.title, r.team_key AS "teamKey"
     FROM video_reviews r
     WHERE r.org_id = $1 AND (r.team_key = ANY($2::text[]) OR r.match_key = $3)
     ORDER BY r.updated_at DESC
     LIMIT 6`,
    [orgId, opponents, matchKey],
  );
  if (reviews.rows.length === 0) return [];

  const notes = await client.query<{ reviewId: string; atSeconds: number; tag: string; body: string }>(
    `SELECT "reviewId", "atSeconds", tag, body FROM (
       SELECT n.review_id AS "reviewId", n.at_seconds AS "atSeconds", n.tag, n.body,
              row_number() OVER (PARTITION BY n.review_id ORDER BY n.at_seconds, n.created_at) AS note_rank
       FROM video_notes n
       WHERE n.org_id = $1 AND n.review_id = ANY($2::uuid[])
     ) ranked
     WHERE note_rank <= 8
     ORDER BY "reviewId", "atSeconds"`,
    [orgId, reviews.rows.map((row) => row.id)],
  );

  const byReview = new Map<string, OpponentIntel["notes"]>();
  for (const note of notes.rows) {
    const list = byReview.get(note.reviewId) ?? [];
    list.push({ atSeconds: Number(note.atSeconds), tag: note.tag, body: note.body });
    byReview.set(note.reviewId, list);
  }

  return reviews.rows.map((row) => ({
    teamKey: row.teamKey ?? "",
    reviewTitle: row.title,
    notes: byReview.get(row.id) ?? [],
  }));
}

/** The human-authored strategy card for this match, or null. */
async function loadCard(
  client: PoolClient,
  orgId: string,
  matchKey: string,
  partnerKeys: string[] = [],
): Promise<BriefingCard | null> {
  const result = await client.query<MatchStrategyCardRow>(
    `SELECT game_plan AS "gamePlan", auto_assignment AS "autoAssignment",
            defense_focus AS "defenseFocus", key_threats AS "keyThreats",
            driver_notes AS "driverNotes", role_assignments AS "roleAssignments",
            updated_at::text AS "updatedAt"
     FROM match_strategy_cards
     WHERE org_id = $1 AND match_key = $2
     LIMIT 1`,
    [orgId, matchKey],
  );
  const partnerNumbers = partnerKeys
    .map((key) => teamNumberFromKey(key))
    .filter((value): value is number => value != null);
  return selectBriefingCard(result.rows[0] ?? null, { partnerNumbers });
}

/** Watchlist notes members left about opponents in this match. */
async function loadWatchNotes(client: PoolClient, orgId: string, opponents: string[]): Promise<BriefingWatchNote[]> {
  if (!opponents.length) return [];
  const result = await client.query<WatchlistEntryRow>(
    `SELECT team_key AS "teamKey", team_number AS "teamNumber", note, created_at::text AS "createdAt"
     FROM opponent_watchlist_entries
     WHERE org_id = $1 AND team_key = ANY($2::text[]) AND note IS NOT NULL AND btrim(note) <> ''
     ORDER BY created_at DESC
     LIMIT 12`,
    [orgId, opponents],
  );
  return selectBriefingWatchNotes(result.rows, opponents);
}

/** Latest defense-planner recommendation per opponent this season. */
async function loadDefensePlans(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
  opponentNumbers: number[],
): Promise<BriefingDefensePlan[]> {
  if (!opponentNumbers.length) return [];
  const result = await client.query<DefensePlannerMatchupRow>(
    `SELECT DISTINCT ON (opponent_team_number)
            opponent_team_number AS "opponentTeamNumber",
            opponent_team_name AS "opponentTeamName",
            recommendation, assigned_defender AS "assignedDefender",
            confidence::float8 AS confidence, rationale, computed_at::text AS "computedAt"
     FROM defense_planner_matchups
     WHERE org_id = $1 AND season_year = $2 AND opponent_team_number = ANY($3::int[])
     ORDER BY opponent_team_number, updated_at DESC`,
    [orgId, seasonYear, opponentNumbers],
  );
  return selectBriefingDefensePlans(result.rows, opponentNumbers);
}

/**
 * Newest counter-book per opposing robot in this match.
 *
 * Reads the same counter_book_reports rows /counter-book writes, scoped by RLS to this org, so a
 * counter-book generated once shows up on the briefing without regenerating (or metering) it. An
 * opponent with no report simply has no row.
 */
async function loadCounterBooks(
  client: PoolClient,
  orgId: string,
  opponents: string[],
): Promise<BriefingCounterBook[]> {
  if (!opponents.length) return [];
  const result = await client.query<CounterBookReportRow>(
    `SELECT id, team_key AS "teamKey", team_number AS "teamNumber", event_key AS "eventKey",
            title, matches_scouted AS "matchesScouted", tendencies,
            failure_triggers AS "failureTriggers", counter_plan AS "counterPlan", summary,
            created_at::text AS "createdAt"
     FROM counter_book_reports
     WHERE org_id = $1 AND team_key = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 24`,
    [orgId, opponents],
  );
  return selectBriefingCounterBooks(result.rows, opponents);
}

/** Open/staged pit-repair triage reports for OUR robot this season. */
async function loadPitReports(client: PoolClient, orgId: string, seasonYear: number): Promise<BriefingPitReport[]> {
  const result = await client.query<BriefingPitReport>(
    `SELECT id, title, subsystem_name AS "subsystemName", decision, status,
            prestage_recommended AS "prestageRecommended", created_at::text AS "createdAt"
     FROM pit_repair_triage_reports
     WHERE org_id = $1 AND season_year = $2 AND status IN ('open', 'staged')
     ORDER BY created_at DESC
     LIMIT 6`,
    [orgId, seasonYear],
  );
  return result.rows;
}

const RECENT_SESSION_LIMIT = 40;

type StrategySections = {
  prediction: BriefingPrediction | null;
  plan: BriefingPlan | null;
  scouted: BriefingScoutedTeam[];
  tendencies: BriefingTendency[];
};

/** Stored prediction + saved strategy plan (playbook/operations/tendencies). */
async function readStoredStrategy(client: PoolClient, orgId: string, matchKey: string): Promise<StrategySections> {
  const [prediction, strategy] = await Promise.all([
    client.query<{
      pRed: number;
      pBlue: number;
      confidenceLow: number;
      confidenceHigh: number;
      modelVersion: string;
      keyFactors: unknown;
      caveats: unknown;
      scoredAt: string | null;
    }>(
      `SELECT p.p_red AS "pRed", p.p_blue AS "pBlue",
              p.confidence_low AS "confidenceLow", p.confidence_high AS "confidenceHigh",
              p.model_version AS "modelVersion", p.key_factors AS "keyFactors",
              p.caveats, p.scored_at::text AS "scoredAt"
       FROM predictions p
       WHERE p.org_id = $1 AND p.match_key = $2
       ORDER BY p.scored_at DESC
       LIMIT 1`,
      [orgId, matchKey],
    ),
    client.query<{ plan: unknown }>(
      `SELECT s.plan FROM match_strategies s
       WHERE s.org_id = $1 AND s.match_key = $2
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      [orgId, matchKey],
    ),
  ]);

  const predictionRow = prediction.rows[0];
  const planJson = strategy.rows[0]?.plan ?? null;
  return {
    prediction: predictionRow
      ? {
          pRed: Number(predictionRow.pRed),
          pBlue: Number(predictionRow.pBlue),
          confidenceLow: Number(predictionRow.confidenceLow),
          confidenceHigh: Number(predictionRow.confidenceHigh),
          modelVersion: predictionRow.modelVersion,
          keyFactors: normalizeKeyFactors(predictionRow.keyFactors),
          caveats: normalizeCaveats(predictionRow.caveats),
          scoredAt: predictionRow.scoredAt,
        }
      : null,
    plan: normalizePlan(planJson),
    scouted: normalizePlanOperations(planJson),
    tendencies: normalizePlanTendencies(planJson),
  };
}

/**
 * When nothing is stored yet, REUSE the existing strategy compute once — it
 * persists its own predictions/match_strategies rows, so subsequent briefing
 * polls read the stored copy. Failures degrade to the honest "Run /strategy"
 * empty state; nothing is ever fabricated here.
 */
async function computeStrategyFallback(
  client: PoolClient,
  input: { userId: string; orgId: string; matchKey: string },
): Promise<StrategySections | null> {
  // computeStrategyView both reads and persists, and the briefing keeps reading
  // after this returns. Under a plain catch a failure here aborted the shared
  // transaction, so the "honest empty state" this promises was accompanied by an
  // equally empty everything-else. Savepointed: only this fallback degrades.
  return withSavepoint(client, async () => {
    const { computeStrategyView } = await import("../strategy/compute-strategy");
    const { finalizeStrategyRecompute } = await import("../strategy/recompute");
    const view = finalizeStrategyRecompute(
      await computeStrategyView(client, {
        userId: input.userId,
        requestedOrg: input.orgId,
        matchKey: input.matchKey,
      }),
    );
    if (view.status !== "live") return null;
    const planJson = {
      playbook: view.playbook,
      tendencies: view.tendencies,
      operations: view.operations,
    };
    return {
      prediction: {
        pRed: view.prediction.pRed,
        pBlue: view.prediction.pBlue,
        confidenceLow: view.prediction.confidenceLow,
        confidenceHigh: view.prediction.confidenceHigh,
        modelVersion: view.prediction.modelVersion,
        keyFactors: normalizeKeyFactors(view.prediction.keyFactors),
        caveats: normalizeCaveats(view.prediction.caveats),
        scoredAt: view.computedAt,
      },
      plan: normalizePlan(planJson),
      scouted: normalizePlanOperations(planJson),
      tendencies: normalizePlanTendencies(planJson),
    };
  }, null);
}

export async function computeBriefingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; requestedMatch: string | null; refresh?: boolean },
): Promise<FullBriefingView> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
    eventKey: string | null;
    eventName: string | null;
    eventYear: number | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
            c.active_event_key AS "eventKey", e.name AS "eventName", e.year AS "eventYear"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );

  const row = membership.rows[0];
  if (!row) {
    return {
      status: "setup_required",
      message: "Select a team to open the pre-match briefing.",
      context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null, eventName: null },
    };
  }

  const context = {
    orgId: row.orgId,
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    role: row.role,
    eventKey: row.eventKey,
    eventName: row.eventName,
  };

  if (!row.eventKey) {
    return { status: "setup_required", message: "Select an active event on Your team.", context };
  }
  if (row.teamNumber == null) {
    return {
      status: "setup_required",
      message: "Set your team number on Your team so the briefing knows which alliance is yours.",
      context,
    };
  }
  const teamKey = `frc${row.teamNumber}`;
  const seasonYear =
    row.eventYear ??
    (Number.isFinite(Number(row.eventKey.slice(0, 4))) ? Number(row.eventKey.slice(0, 4)) : new Date().getUTCFullYear());

  const matches = await client.query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
    redAlliance: AllianceJson;
    blueAlliance: AllianceJson;
  }>(
    `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
            COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
            m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
     FROM matches_ref m
     WHERE m.event_key = $1
     ORDER BY CASE m.comp_level
                WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
              END, m.match_number`,
    [row.eventKey],
  );

  const ourRows = matches.rows
    .map((entry) => ({
      matchKey: entry.matchKey,
      compLevel: entry.compLevel,
      matchNumber: entry.matchNumber,
      scheduledTime: entry.scheduledTime,
      red: teamKeysOf(entry.redAlliance),
      blue: teamKeysOf(entry.blueAlliance),
      redScore: allianceScore(entry.redAlliance),
      blueScore: allianceScore(entry.blueAlliance),
    }))
    .filter((entry) => entry.red.includes(teamKey) || entry.blue.includes(teamKey));

  const selected =
    ourRows.find((entry) => entry.matchKey === input.requestedMatch) ??
    ourRows.find((entry) => entry.redScore == null || entry.blueScore == null) ??
    ourRows[0];
  if (!selected) {
    return {
      status: "setup_required",
      message: "No matches for your team at this event yet — sync TBA first.",
      context,
    };
  }

  const match: BriefingMatch = {
    matchKey: selected.matchKey,
    compLevel: selected.compLevel,
    matchNumber: selected.matchNumber,
    scheduledTime: selected.scheduledTime,
    red: selected.red,
    blue: selected.blue,
  };
  const ourAlliance = ourAllianceOf(match, teamKey);
  const ourKeys = ourAlliance === "red" ? match.red : ourAlliance === "blue" ? match.blue : [];
  const opponents = ourAlliance === "red" ? match.blue : ourAlliance === "blue" ? match.red : [];
  const allyKeys = ourKeys.filter((key) => key !== teamKey);
  const opponentNumbers = opponents
    .map((key) => teamNumberFromKey(key))
    .filter((value): value is number => value != null);

  // Prediction + saved plan: stored rows first. ?refresh=1 recomputes via
  // recomputeStrategyView (same as /api/strategy?refresh=1); empty EPA stays
  // empty. Otherwise reuse strategy compute once when nothing is stored yet.
  let strategySections = await readStoredStrategy(client, row.orgId, match.matchKey);
  if (input.refresh) {
    const refreshed = await refreshBriefingPrediction(client, {
      userId: input.userId,
      orgId: row.orgId,
      matchKey: match.matchKey,
    });
    // Refresh was requested: keep plan/scout rows, but never keep a stale
    // stored win % after an empty or failed recompute.
    strategySections = refreshed
      ? refreshed
      : { ...strategySections, prediction: null };
  } else if (!strategySections.prediction) {
    const computed = await computeStrategyFallback(client, {
      userId: input.userId,
      orgId: row.orgId,
      matchKey: match.matchKey,
    });
    if (computed) strategySections = computed;
  }

  const [play, sessions, cycles, opponentIntel, scoutCount, card, counterBooks, watchNotes, defensePlans, pitReports, openRisks, batteries, teamsByKey, persistedBrief] =
    await Promise.all([
      client.query<{ id: string; title: string; description: string; strokeCount: number | null; updatedAt: string }>(
        `SELECT p.id, p.title, p.description,
                CASE WHEN jsonb_typeof(p.strokes) = 'array' THEN jsonb_array_length(p.strokes) ELSE 0 END AS "strokeCount",
                p.updated_at::text AS "updatedAt"
         FROM whiteboard_plays p
         WHERE p.org_id = $1 AND p.match_key = $2
         ORDER BY p.updated_at DESC
         LIMIT 1`,
        [row.orgId, match.matchKey],
      ),
      client.query<Omit<DriverSession, "cycles">>(
        `SELECT s.id, s.title, s.event_key AS "eventKey", s.session_date::text AS "sessionDate",
                s.driver_user_id AS "driverUserId", s.driver_name AS "driverName",
                s.location, s.goal, s.notes, s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt"
         FROM driver_sessions s
         WHERE s.org_id = $1
         ORDER BY s.session_date DESC, s.created_at DESC
         LIMIT ${RECENT_SESSION_LIMIT}`,
        [row.orgId],
      ),
      client.query<DriverCycle>(
        `SELECT c.id, c.session_id AS "sessionId", c.action, c.seconds::float8 AS seconds, c.success,
                c.note, c.rep_index AS "repIndex", c.created_at::text AS "createdAt"
         FROM driver_cycles c
         WHERE c.org_id = $1
           AND c.session_id IN (
             SELECT id FROM driver_sessions
             WHERE org_id = $1
             ORDER BY session_date DESC, created_at DESC
             LIMIT ${RECENT_SESSION_LIMIT}
           )
         ORDER BY c.session_id, c.rep_index, c.created_at`,
        [row.orgId],
      ),
      loadOpponentIntel(client, row.orgId, match.matchKey, opponents),
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM scout_assignments WHERE org_id = $1 AND match_key = $2`,
        [row.orgId, match.matchKey],
      ),
      loadCard(client, row.orgId, match.matchKey, allyKeys),
      loadCounterBooks(client, row.orgId, opponents),
      loadWatchNotes(client, row.orgId, opponents),
      loadDefensePlans(client, row.orgId, seasonYear, opponentNumbers),
      loadPitReports(client, row.orgId, seasonYear),
      loadOpenRisks(client, row.orgId, seasonYear),
      loadBatteryFleet(client, row.orgId),
      loadTeams(client, row.eventKey, [...new Set([teamKey, ...allyKeys, ...opponents])]),
      loadLatestBrief(client, row.orgId, match.matchKey),
    ]);

  const playRow = play.rows[0];
  const bySession = new Map<string, DriverCycle[]>();
  for (const cycle of cycles.rows) {
    const list = bySession.get(cycle.sessionId) ?? [];
    list.push(cycle);
    bySession.set(cycle.sessionId, list);
  }
  const practiceSessions: DriverSession[] = sessions.rows.map((sessionRow) => ({
    ...sessionRow,
    attendanceEventId: null,
    attendanceEventTitle: null,
    attendanceOccurredOn: null,
    buildTaskId: null,
    buildTaskTitle: null,
    cycles: bySession.get(sessionRow.id) ?? [],
  }));

  const pickTeams = (keys: string[]): MatchCopilotTeam[] =>
    keys.map((key) => teamsByKey.get(key)).filter((team): team is MatchCopilotTeam => Boolean(team));
  const allyTeams = pickTeams(allyKeys);
  const opponentTeams = pickTeams(opponents);
  const ourEpaTotal = teamsByKey.get(teamKey)?.epaTotal ?? null;

  const { allies: alliesScouted, opponents: opponentsScouted } = splitScoutedByAlliance(
    strategySections.scouted,
    ourKeys,
    opponents,
  );

  // Do-this callouts: the persisted Match Copilot brief when one exists, else
  // the same deterministic composer (pure, never metered on read).
  let callouts: MatchCopilotCallout[] = persistedBrief?.callouts ?? [];
  if (!callouts.length && ourAlliance) {
    callouts = composeMatchCopilotCallouts({
      alliance: ourAlliance,
      opponents: opponentTeams,
      ourEpaTotal,
      hasStrategyPlan: strategySections.plan != null,
      strategySummary: strategySections.plan?.priorities[0] ?? null,
      openRisks,
      batteryFleet: batteries,
    });
  }

  const base: Extract<BriefingView, { status: "ready" }> = {
    status: "ready",
    context,
    match,
    ourAlliance,
    prediction: strategySections.prediction,
    plan: strategySections.plan,
    play: playRow
      ? {
          id: playRow.id,
          title: playRow.title,
          description: playRow.description,
          strokeCount: playRow.strokeCount == null ? 0 : Number(playRow.strokeCount),
          updatedAt: playRow.updatedAt,
        }
      : null,
    practice: practiceReadiness(practiceSessions),
    opponentIntel,
    scoutCount: scoutCount.rows[0] ? Number(scoutCount.rows[0].count) : 0,
    ourMatches: ourRows.map((entry) => ({
      matchKey: entry.matchKey,
      label: matchLabel(entry.compLevel, entry.matchNumber),
    })),
  };

  return {
    ...base,
    allyTeams,
    opponentTeams,
    ourEpaTotal,
    alliesScouted,
    opponentsScouted,
    tendencies: strategySections.tendencies,
    card,
    counterBooks,
    counterBookGaps: computeCounterBookGaps(counterBooks, opponents),
    watchNotes,
    defensePlans,
    pitReports,
    openRisks,
    batteries,
    callouts,
  };
}
