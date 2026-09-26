/**
 * "How many matches did we scout this robot?" — one answer for every screen.
 *
 * Research counted report rows (two scouts on one match counted twice, and
 * reports for matches not played yet counted too); the pick desk counted
 * trusted rows and called them matches; Strategy counted its own sample. The
 * same robot read 14, 8 and 7.
 *
 * Here a match counts once, however many scouts watched it, and only when the
 * report can be a real observation: the match has a result, or its scheduled
 * time has come. A report saved for a match still hours away (a test, or a
 * tablet on the wrong match) is not a match scouted.
 */
import type { PoolClient } from "@neondatabase/serverless";

/**
 * SQL predicate: this match can have been watched. `m` is a matches_ref alias.
 * A match with no time and no result is given the benefit of the doubt (an
 * event that posts nothing), so off-season scouting still counts.
 */
export function observableMatchSql(alias = "m"): string {
  const m = `${alias}.`;
  return `(
    ${m}winning_alliance IS NOT NULL
    OR ${m}actual_time IS NOT NULL
    OR ${m}post_result_time IS NOT NULL
    OR COALESCE(${m}predicted_time, ${m}event_time) IS NULL
    OR COALESCE(${m}predicted_time, ${m}event_time) <= now() + interval '10 minutes'
  )`;
}

/** Distinct matches scouted per robot at one event, counting only matches that can have been watched. */
export async function loadScoutedMatchCounts(
  client: PoolClient,
  input: { orgId: string; eventKey: string },
): Promise<Map<string, number>> {
  const result = await client.query<{ teamKey: string; matches: number | string }>(
    `SELECT e.team_key AS "teamKey", count(DISTINCT e.match_key)::int AS matches
       FROM match_scout_entries e
       JOIN matches_ref m ON m.match_key = e.match_key
      WHERE e.org_id = $1::uuid AND e.event_key = $2::text
        AND ${observableMatchSql("m")}
      GROUP BY e.team_key`,
    [input.orgId, input.eventKey],
  );
  return new Map(result.rows.map((row) => [row.teamKey, Number(row.matches) || 0]));
}

/** "1 match scouted" / "12 matches scouted". Null for none, so a screen shows nothing rather than "0". */
export function matchesScoutedLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return `${count} ${count === 1 ? "match" : "matches"} scouted`;
}
