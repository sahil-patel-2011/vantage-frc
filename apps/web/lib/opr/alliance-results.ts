import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { eventOpr, type AllianceResult, type TeamOpr } from "@vantage/prediction-strategy";

/** matches_ref as the reference worker writes it. */
export type PlayedMatchRow = {
  matchKey: string;
  matchNumber: number;
  redAlliance: unknown;
  blueAlliance: unknown;
  scoreBreakdown: Record<string, unknown> | null;
};

const ENDGAME_KEYS = [
  "endGamePoints",
  "endgamePoints",
  "endGameBargePoints",
  "endGameTotalStagePoints",
  "endgameTotalPoints",
] as const;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function allianceOf(value: unknown): { teamKeys: string[]; score: number | null } {
  if (!value || typeof value !== "object") return { teamKeys: [], score: null };
  const record = value as Record<string, unknown>;
  const keys = record.teamKeys ?? record.team_keys;
  return {
    teamKeys: Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [],
    score: num(record.score),
  };
}

/**
 * Each played alliance's official score, with fouls it was handed by the other alliance removed
 * when the breakdown says how many (OPR is about what a robot scores, not what it draws), and the
 * auto / teleop / endgame parts when the breakdown has them. TBA writes -1 for an unplayed score;
 * those rows are skipped.
 */
export function allianceResultsFromMatches(rows: readonly PlayedMatchRow[]): AllianceResult[] {
  const out: AllianceResult[] = [];
  for (const row of rows) {
    for (const side of ["red", "blue"] as const) {
      const alliance = allianceOf(side === "red" ? row.redAlliance : row.blueAlliance);
      if (alliance.teamKeys.length === 0 || alliance.score == null || alliance.score < 0) continue;
      const part = row.scoreBreakdown?.[side];
      const breakdown = part && typeof part === "object" ? (part as Record<string, unknown>) : null;
      const fouls = breakdown ? num(breakdown.foulPoints) : null;
      const endgameKey = breakdown ? ENDGAME_KEYS.find((key) => num(breakdown[key]) != null) : undefined;
      out.push({
        matchKey: row.matchKey,
        order: row.matchNumber,
        teamKeys: alliance.teamKeys,
        total: Math.max(0, alliance.score - (fouls ?? 0)),
        auto: breakdown ? num(breakdown.autoPoints) : null,
        teleop: breakdown ? num(breakdown.teleopPoints) : null,
        endgame: breakdown && endgameKey ? num(breakdown[endgameKey]) : null,
      });
    }
  }
  return out;
}

/**
 * This event's OPR from its played quals, read under the caller's RLS client. In a savepoint, so
 * a failed read leaves the caller's transaction usable and returns nothing.
 */
export async function loadEventOpr(client: PoolClient, eventKey: string): Promise<TeamOpr[]> {
  return withSavepoint(client, async () => eventOpr(await readPlayedResults(client, eventKey)), []);
}

/** What a match prediction needs from the event's played quals. */
export type EventScoring = {
  /** Every robot that has played, rated by OPR; the ridge pulls a one-match robot toward the field. */
  opr: TeamOpr[];
  /** Average alliance score over the played quals (fouls drawn removed), or null before any. */
  averageAllianceScore: number | null;
  /** Alliance results the numbers rest on. */
  alliances: number;
};

/**
 * Each robot's OPR at this event and the event's scoring level, for Home and the match plan.
 *
 * Rated from a robot's first match rather than its third: replayed on 2025gagai and 2026gagr,
 * that predicted every match (not 115 of 141) for about the same accuracy, because the ridge in
 * eventOpr already keeps a one-match robot near the event average. Recent matches are not
 * weighted up (decay 1): on the same replay, decay picked fewer winners.
 */
export async function loadEventScoring(client: PoolClient, eventKey: string): Promise<EventScoring> {
  return withSavepoint(client, async () => eventScoringFrom(await readPlayedResults(client, eventKey)), {
    opr: [],
    averageAllianceScore: null,
    alliances: 0,
  });
}

/**
 * Same numbers as `loadEventScoring`, without a savepoint.
 * Call it inside a wave of other reads. A failed statement is isolated by that
 * wave; a savepoint here would split the wave into its own round trips.
 */
export async function readEventScoring(client: PoolClient, eventKey: string): Promise<EventScoring> {
  try {
    return eventScoringFrom(await readPlayedResults(client, eventKey));
  } catch {
    return { opr: [], averageAllianceScore: null, alliances: 0 };
  }
}

export function eventScoringFrom(results: readonly AllianceResult[]): EventScoring {
  if (!results.length) return { opr: [], averageAllianceScore: null, alliances: 0 };
  return {
    opr: eventOpr(results, { decay: 1, minMatches: 1 }),
    averageAllianceScore: Math.round((results.reduce((sum, row) => sum + row.total, 0) / results.length) * 10) / 10,
    alliances: results.length,
  };
}

async function readPlayedResults(client: PoolClient, eventKey: string): Promise<AllianceResult[]> {
  const played = await client.query<PlayedMatchRow>(
    `SELECT match_key AS "matchKey", match_number AS "matchNumber",
            red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
            score_breakdown AS "scoreBreakdown"
       FROM matches_ref
      WHERE event_key = $1::text AND comp_level = 'qm' AND winning_alliance IS NOT NULL`,
    [eventKey],
  );
  return allianceResultsFromMatches(played.rows);
}
