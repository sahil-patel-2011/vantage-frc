/**
 * Why a team has no upcoming match, said the same way on every screen.
 *
 * Home said "No upcoming match found", Event day "Waiting for schedule", Strategy "has no
 * scheduled match yet" and the pit TV "No upcoming team match" — four answers for one state,
 * and none of them said the most common reason: every match at this event is already played.
 */

import type { PoolClient } from "@neondatabase/serverless";

export type OurMatchSummary = {
  /** Our matches on the synced schedule (placeholders excluded). */
  total: number;
  /** Of those, how many are over: a posted result, or a start time already past. */
  played: number;
  last: { label: string; ours: number | null; theirs: number | null; won: boolean | null } | null;
};

const LEVEL: Record<string, string> = { qm: "Qual", ef: "Eighth", qf: "Quarter", sf: "Semi", f: "Final" };

export function matchShortLabel(compLevel: string, matchNumber: number, setNumber?: number | null): string {
  const level = LEVEL[compLevel] ?? compLevel.toUpperCase();
  if (compLevel === "qm" || !setNumber || setNumber <= 1) return `${level} ${matchNumber}`;
  return `${level} ${setNumber}-${matchNumber}`;
}

export function noNextMatchMessage(summary: OurMatchSummary | null): string {
  if (!summary || summary.total === 0) return "The match schedule for this event isn't out yet.";
  if (summary.played >= summary.total) {
    const last = summary.last;
    if (!last) return `All ${summary.total} of our matches here are played.`;
    const score =
      last.ours != null && last.theirs != null
        ? ` (${last.won === true ? "W" : last.won === false ? "L" : "T"} ${last.ours}–${last.theirs})`
        : "";
    return `All ${summary.total} of our matches here are played. Last: ${last.label}${score}.`;
  }
  return "Our next match doesn't have a time posted yet.";
}

/** One read for the summary above, from the shared reference tables. */
export async function loadOurMatchSummary(client: PoolClient, eventKey: string, teamKey: string): Promise<OurMatchSummary> {
  const counts = (
    await client.query<{ total: string; played: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE winning_alliance IS NOT NULL OR post_result_time IS NOT NULL
                                OR COALESCE(actual_time, predicted_time, event_time) <= now())::text AS played
         FROM matches_ref
        WHERE event_key = $1::text
          AND NOT placeholder
          AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)`,
      [eventKey, teamKey],
    )
  ).rows[0];
  const last = (
    await client.query<{ compLevel: string; matchNumber: number; setNumber: number; red: string | null; blue: string | null; onRed: boolean; winner: string | null }>(
      `SELECT comp_level AS "compLevel", match_number AS "matchNumber", set_number AS "setNumber",
              red_alliance->>'score' AS red, blue_alliance->>'score' AS blue,
              (red_alliance->'teamKeys' ? $2::text) AS "onRed", winning_alliance AS winner
         FROM matches_ref
        WHERE event_key = $1::text
          AND NOT placeholder
          AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)
          AND (winning_alliance IS NOT NULL OR post_result_time IS NOT NULL
               OR COALESCE(actual_time, predicted_time, event_time) <= now())
        ORDER BY COALESCE(actual_time, predicted_time, event_time) DESC NULLS LAST, match_number DESC
        LIMIT 1`,
      [eventKey, teamKey],
    )
  ).rows[0];
  const num = (value: string | null) => {
    const n = value == null ? NaN : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    total: Number(counts?.total ?? 0),
    played: Number(counts?.played ?? 0),
    last: last
      ? {
          label: matchShortLabel(last.compLevel, last.matchNumber, last.setNumber),
          ours: num(last.onRed ? last.red : last.blue),
          theirs: num(last.onRed ? last.blue : last.red),
          // TBA marks a tie with an empty winning_alliance.
          won: last.winner === "red" || last.winner === "blue" ? (last.winner === "red") === last.onRed : null,
        }
      : null,
  };
}
