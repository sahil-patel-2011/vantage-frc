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

/**
 * How much scouting an event has, as ONE set of numbers every screen shows.
 *
 * Teams said "9 robots · 12 matches scouted", the pick list "3 with our notes", Assignments
 * "13 of 384" and Ask AI "6 teams" about the same weekend, because each counted its own way
 * (rated teams only, reports with a known form only, schedule slots only, the six newest
 * teams). This is the shared definition; a screen may show a narrower slice (a filter, a
 * schedule) but never a different count of the same thing.
 *
 * A report counts when it is a `match_scout_entries` row for this org and event whose match is
 * in `matches_ref` and can have been watched (`observableMatchSql`). Nothing else is required:
 * not a form (scout_schemas) row, not a rating (team_event_metrics) row, not a schedule slot.
 *
 * - `robots`: distinct teams with at least one such report ("9 robots", "9 scouted").
 * - `robotMatches`: distinct (team, match) pairs — one robot in one match, however many scouts
 *   watched it ("12 matches scouted", "12 robot-matches"). Assignments' scouted slots add up to
 *   this when every report names a robot that was in that match.
 * - `reports`: the rows themselves, so two scouts on one robot count twice ("14 reports").
 */
export type ScoutingTotals = { robots: number; robotMatches: number; reports: number };

export async function loadScoutingTotals(
  client: PoolClient,
  input: { orgId: string; eventKey: string },
): Promise<ScoutingTotals> {
  const result = await client.query<{ robots: number | string; robotMatches: number | string; reports: number | string }>(
    `SELECT count(DISTINCT e.team_key)::int AS robots,
            count(DISTINCT e.team_key || '|' || e.match_key)::int AS "robotMatches",
            count(*)::int AS reports
       FROM match_scout_entries e
       JOIN matches_ref m ON m.match_key = e.match_key
      WHERE e.org_id = $1::uuid AND e.event_key = $2::text
        AND ${observableMatchSql("m")}`,
    [input.orgId, input.eventKey],
  );
  const row = result.rows[0];
  return {
    robots: Number(row?.robots) || 0,
    robotMatches: Number(row?.robotMatches) || 0,
    reports: Number(row?.reports) || 0,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** "9 robots · 12 matches scouted" — the Teams header and Ask AI's opening line. */
export function robotsAndMatchesLabel(robots: number, robotMatches: number): string {
  return `${plural(robots, "robot", "robots")} · ${plural(robotMatches, "match", "matches")} scouted`;
}

/** The same words from a totals object. */
export function scoutingTotalsLabel(totals: ScoutingTotals): string {
  return robotsAndMatchesLabel(totals.robots, totals.robotMatches);
}

/**
 * The pick list subtitle's counts: "32 teams · 9 scouted (2 not rated yet)".
 *
 * `teams` is the candidate pool (teams with a rating row); `scouted` is `ScoutingTotals.robots`,
 * so it can include robots the pool does not list yet — said in words rather than dropped.
 */
export function pickListCountsLabel(input: { teams: number; scouted: number; scoutedNotRated?: number }): string {
  const parts = [plural(input.teams, "team", "teams")];
  if (input.scouted > 0) {
    const notRated = input.scoutedNotRated ?? 0;
    parts.push(`${input.scouted.toLocaleString("en-US")} scouted${notRated > 0 ? ` (${notRated.toLocaleString("en-US")} not rated yet)` : ""}`);
  }
  return parts.join(" · ");
}

/**
 * Data-quality note for reports whose team was not in that match's alliance. They still count
 * in the event totals (a robot was watched and written down) but fill no schedule slot, so
 * coverage reads lower than Teams. Null when there are none.
 */
export function wrongRobotNote(robotMatches: number | null | undefined): string | null {
  if (!robotMatches || robotMatches <= 0) return null;
  return robotMatches === 1
    ? "1 robot-match was reported for a team that was not in that match, so it fills no slot here. Check the team number on that report."
    : `${robotMatches.toLocaleString("en-US")} robot-matches were reported for teams that were not in those matches, so they fill no slot here. Check the team numbers on those reports.`;
}
