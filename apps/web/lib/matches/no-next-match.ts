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

/** "2026gacmp_qm28" -> "Qual 28", "…_sf2m1" -> "Semi 2-1". The raw key if it is not a match key. */
export function matchLabelFromKey(matchKey: string): string {
  const match = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey.trim());
  if (!match) return matchKey;
  const level = match[1]!.toLowerCase();
  const first = Number(match[2]);
  if (level === "qm" || !match[3]) return matchShortLabel(level, first);
  return matchShortLabel(level, Number(match[3]), first);
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
const OVER = `(winning_alliance IS NOT NULL OR post_result_time IS NOT NULL OR actual_time IS NOT NULL
               OR COALESCE(predicted_time, event_time) <= now() - interval '3 hours')`;

/** One read for the summary above, from the shared reference tables. */
export async function loadOurMatchSummary(client: PoolClient, eventKey: string, teamKey: string): Promise<OurMatchSummary> {
  const counts = (
    await client.query<{ total: string; played: string; behind: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE ${OVER})::text AS played,
              count(*) FILTER (WHERE NOT (${OVER}) AND COALESCE(predicted_time, event_time) <= now())::text AS behind
         FROM matches_ref
        WHERE event_key = $1::text
          AND NOT placeholder
          AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)`,
      [eventKey, teamKey],
    )
  ).rows[0];
  // None of ours: is the schedule out at all? (Then the team is simply not in this event.)
  const eventMatches =
    Number(counts?.total ?? 0) === 0
      ? Number(
          (
            await client.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM matches_ref WHERE event_key = $1::text AND NOT placeholder`,
              [eventKey],
            )
          ).rows[0]?.n ?? 0,
        )
      : undefined;
  const last = (
    await client.query<{ compLevel: string; matchNumber: number; setNumber: number; red: string | null; blue: string | null; onRed: boolean; winner: string | null }>(
      `SELECT comp_level AS "compLevel", match_number AS "matchNumber", set_number AS "setNumber",
              red_alliance->>'score' AS red, blue_alliance->>'score' AS blue,
              (red_alliance->'teamKeys' ? $2::text) AS "onRed", winning_alliance AS winner
         FROM matches_ref
        WHERE event_key = $1::text
          AND NOT placeholder
          AND (red_alliance->'teamKeys' ? $2::text OR blue_alliance->'teamKeys' ? $2::text)
          AND ${OVER}
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
    eventMatches,
    teamNumber: teamKey.replace(/^frc/i, ""),
    total: Number(counts?.total ?? 0),
    played: Number(counts?.played ?? 0),
    behind: Number(counts?.behind ?? 0),
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
