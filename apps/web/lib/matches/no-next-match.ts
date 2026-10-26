/**
 * Why a team has no upcoming match, said the same way on every screen.
 *
 * Home said "No upcoming match found", Event day "Waiting for schedule", Strategy "has no
 * scheduled match yet" and the pit TV "No upcoming team match" — four answers for one state,
 * and none of them said the most common reason: every match at this event is already played.
 */

import { matchLabelFromKey as sharedLabelFromKey } from "./match-label";
import type { PoolClient } from "@neondatabase/serverless";
import { matchStillAheadSql } from "./match-ahead-sql";

export type OurMatchSummary = {
  /** Our matches on the synced schedule (placeholders excluded). */
  total: number;
  /**
   * Of those, how many are over: a posted result, a recorded start, or a scheduled time more than
   * three hours ago (a synced schedule whose results never arrived). A match only just past its
   * time with none of those is running late, not over.
   */
  played: number;
  /** Past their scheduled time by under three hours, with no result: the event is behind. */
  behind?: number;
  /** Matches on the event's schedule for anyone. With none of ours, the team is not in it. */
  eventMatches?: number;
  /** "6925", for saying which team is missing from the schedule. */
  teamNumber?: string;
  last: { label: string; ours: number | null; theirs: number | null; won: boolean | null } | null;
};

const LEVEL: Record<string, string> = { qm: "Qual", ef: "Eighth", qf: "Quarter", sf: "Semi", f: "Final" };

export function matchShortLabel(compLevel: string, matchNumber: number, setNumber?: number | null): string {
  const level = LEVEL[compLevel] ?? compLevel.toUpperCase();
  if (compLevel === "qm" || !setNumber || setNumber <= 1) return `${level} ${matchNumber}`;
  return `${level} ${setNumber}-${matchNumber}`;
}

/** "2026gacmp_qm28" -> "Qual 28", "…_sf2m1" -> "Playoff 2" (lib/matches/match-label). The raw key if it is not a match key. */
export function matchLabelFromKey(matchKey: string): string {
  return sharedLabelFromKey(matchKey) ?? matchKey;
}

export function noNextMatchMessage(summary: OurMatchSummary | null): string {
  if (summary && summary.total === 0 && (summary.eventMatches ?? 0) > 0) {
    // The schedule is out and we are not on it: usually the wrong event was picked. Home, Event
    // day and My Day said "isn't out yet" for an event 30 matches in.
    return `Team ${summary.teamNumber ?? "our team"} isn't on this event's match schedule. Check that it's the event you're at.`;
  }
  if (!summary || summary.total === 0) return "The match schedule for this event isn't out yet.";
  if (summary.played >= summary.total) {
    const last = summary.last;
    if (!last) return `All ${summary.total} of our matches here are played.`;
    const score =
      last.ours != null && last.theirs != null
        ? ` (${last.won === true ? "W" : last.won === false ? "L" : "T"} ${last.ours}–${last.theirs})`
        : // Otherwise "Recent result" (the last scored match) names an earlier one and the two
          // cards look like they disagree.
          " (score not posted yet)";
    return `All ${summary.total} of our matches here are played. Last: ${last.label}${score}.`;
  }
  if ((summary.behind ?? 0) > 0) return "Our next match is running behind schedule.";
  return "Our next match doesn't have a time posted yet.";
}

/** SQL for "this match is over" (see OurMatchSummary.played). A constant, never user input. */
// The same rule every "next match" query uses (match-ahead-sql.ts), including "a later qual has
// a result", so a late event's unplayed match is not counted as played.
const OVER = `(NOT ${matchStillAheadSql()})`;

/**
 * Counts and the last result are one statement. Home, My Day, and Event day all ask
 * for this when nothing is ahead; sharing the in-flight promise keeps those callers
 * on a single round trip. The promise is dropped when it settles so a pooled
 * connection cannot reuse another request's answer.
 */
const summaryInflight = new WeakMap<PoolClient, Map<string, Promise<OurMatchSummary>>>();

/** One read for the summary above, from the shared reference tables. */
export function loadOurMatchSummary(client: PoolClient, eventKey: string, teamKey: string): Promise<OurMatchSummary> {
  let bucket = summaryInflight.get(client);
  if (!bucket) {
    bucket = new Map();
    summaryInflight.set(client, bucket);
  }
  const key = `${eventKey}\0${teamKey}`;
  const existing = bucket.get(key);
  if (existing) return existing;
  const pending = queryOurMatchSummary(client, eventKey, teamKey).finally(() => {
    const current = summaryInflight.get(client);
    if (current?.get(key) === pending) current.delete(key);
  });
  bucket.set(key, pending);
  return pending;
}

async function queryOurMatchSummary(client: PoolClient, eventKey: string, teamKey: string): Promise<OurMatchSummary> {
  const row = (
    await client.query<{
      total: string;
      played: string;
      behind: string;
      eventMatches: string;
      compLevel: string | null;
      matchNumber: number | null;
      setNumber: number | null;
      red: string | null;
      blue: string | null;
      onRed: boolean | null;
      winner: string | null;
    }>(
      `SELECT counts.total, counts.played, counts.behind, events.n AS "eventMatches",
              last_row.comp_level AS "compLevel", last_row.match_number AS "matchNumber",
              last_row.set_number AS "setNumber", last_row.red, last_row.blue,
              last_row.on_red AS "onRed", last_row.winner
         FROM (
           SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE ${OVER})::text AS played,
                  count(*) FILTER (WHERE NOT (${OVER}) AND COALESCE(predicted_time, event_time) <= now())::text AS behind
             FROM matches_ref
            WHERE event_key = $1::text
              AND NOT placeholder
              AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)
         ) counts
         CROSS JOIN (
           SELECT count(*)::text AS n
             FROM matches_ref
            WHERE event_key = $1::text AND NOT placeholder
         ) events
         LEFT JOIN LATERAL (
           SELECT comp_level, match_number, set_number,
                  red_alliance->>'score' AS red, blue_alliance->>'score' AS blue,
                  (red_alliance->'teamKeys' ? $2::text) AS on_red, winning_alliance AS winner
             FROM matches_ref
            WHERE event_key = $1::text
              AND NOT placeholder
              AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)
              AND ${OVER}
            ORDER BY COALESCE(actual_time, predicted_time, event_time) DESC NULLS LAST, match_number DESC
            LIMIT 1
         ) last_row ON true`,
      [eventKey, teamKey],
    )
  ).rows[0];
  const total = Number(row?.total ?? 0);
  const num = (value: string | null) => {
    const n = value == null ? NaN : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const last = row?.compLevel
    ? {
        label: matchShortLabel(row.compLevel, row.matchNumber ?? 0, row.setNumber),
        ours: num(row.onRed ? row.red : row.blue),
        theirs: num(row.onRed ? row.blue : row.red),
        // TBA marks a tie with an empty winning_alliance.
        won: row.winner === "red" || row.winner === "blue" ? (row.winner === "red") === Boolean(row.onRed) : null,
      }
    : null;
  return {
    eventMatches: total === 0 ? Number(row?.eventMatches ?? 0) : undefined,
    teamNumber: teamKey.replace(/^frc/i, ""),
    total,
    played: Number(row?.played ?? 0),
    behind: Number(row?.behind ?? 0),
    last,
  };
}

export type OurQualRecord = { wins: number; losses: number; ties: number };

/**
 * Our qualification record at this event, counted from the posted results in the same match
 * table the "matches played" line reads, so the two never disagree. Null until a result is in.
 */
export async function loadOurQualRecord(client: PoolClient, eventKey: string, teamKey: string): Promise<OurQualRecord | null> {
  const row = (
    await client.query<{ wins: string; losses: string; ties: string }>(
      `WITH ours AS (
         SELECT (red_alliance->'teamKeys' ? $2::text) AS on_red, winning_alliance AS winner
           FROM matches_ref
          WHERE event_key = $1::text
            AND comp_level = 'qm'
            AND NOT placeholder
            AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)
            AND COALESCE((red_alliance->>'score')::numeric, -1) >= 0
            AND COALESCE((blue_alliance->>'score')::numeric, -1) >= 0
            AND winning_alliance IS NOT NULL
       )
       SELECT count(*) FILTER (WHERE winner IN ('red', 'blue') AND (winner = 'red') = on_red)::text AS wins,
              count(*) FILTER (WHERE winner IN ('red', 'blue') AND (winner = 'red') <> on_red)::text AS losses,
              count(*) FILTER (WHERE winner NOT IN ('red', 'blue'))::text AS ties
         FROM ours`,
      [eventKey, teamKey],
    )
  ).rows[0];
  const wins = Number(row?.wins ?? 0);
  const losses = Number(row?.losses ?? 0);
  const ties = Number(row?.ties ?? 0);
  return wins + losses + ties > 0 ? { wins, losses, ties } : null;
}
