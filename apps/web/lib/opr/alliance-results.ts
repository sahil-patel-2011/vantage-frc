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
  return withSavepoint(client, () => readEventOpr(client, eventKey), []);
}

async function readEventOpr(client: PoolClient, eventKey: string): Promise<TeamOpr[]> {
  const played = await client.query<PlayedMatchRow>(
    `SELECT match_key AS "matchKey", match_number AS "matchNumber",
            red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
            score_breakdown AS "scoreBreakdown"
       FROM matches_ref
      WHERE event_key = $1::text AND comp_level = 'qm' AND winning_alliance IS NOT NULL`,
    [eventKey],
  );
  return eventOpr(allianceResultsFromMatches(played.rows));
}
