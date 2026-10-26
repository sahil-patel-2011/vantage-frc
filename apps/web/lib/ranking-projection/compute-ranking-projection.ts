import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { allianceWinProbabilityForEvent, seedOdds, type TeamSeedOdds } from "@vantage/prediction-strategy";
import {
  allianceTeamKeys,
  buildRemainingMatches,
  buildStandings,
  rankingPointRulesForYear,
  rankingPointsFromPlayedMatches,
  type BuiltRemainingMatch,
  type MetricRow,
  type RankingPointRules,
  type RatingMap,
  type StandingTeam,
} from "../best-path";
import { loadEventScoring, type EventScoring } from "../opr/alliance-results";

export type RankingProjectionSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/**
 * Everything the in-browser Best Path planner needs. Built from cached rows
 * only: standings the event actually published, the unplayed schedule, and a
 * per-match prediction that is null whenever a robot has no rating. Every
 * robot in one projection uses the same kind of rating: a saved season rating
 * when every robot has one, otherwise the points each robot scored in matches
 * already played here. The two are never added together. A robot with no
 * played match stays unrated when the event is using played-match ratings.
 */
export type RankingProjectionWhatIf = {
  rules: RankingPointRules;
  /** Where each team's banked ranking points came from. */
  rankingPointSource: "official" | "record";
  standings: StandingTeam[];
  remaining: BuiltRemainingMatch[];
  /** Teams in the metrics table we could not project — named, never zeroed. */
  excludedTeams: string[];
  /** Remaining matches we deliberately refused to predict. */
  unpredictedMatches: number;
  /** Honest caveats to print next to the projection. Never suppressed. */
  caveats: string[];
  /**
   * One scale for the whole event. "season" is a saved season rating for every
   * robot. "played" is points from matches already played. "none" means no
   * robot could be rated, so remaining matches stay unpredicted.
   */
  ratingSource: ProjectionRatingSource;
  /**
   * The rest of quals played out 10,000 times from each match's win chance: every team's odds of
   * finishing as an alliance captain and its likely seed range. Null when no quals are left.
   */
  seedOdds: {
    iterations: number;
    captains: number;
    teams: TeamSeedOdds[];
    unpredictedMatches: number;
  } | null;
};

export type RankingProjectionView =
  | {
      status: "setup_required";
      message: string;
      steps: RankingProjectionSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      teamKey: string;
      eventKey: string;
      eventName: string;
      currentRank: number | null;
      record: string | null;
      remainingQuals: number;
      playedQuals: number;
      epaTotal: number | null;
      computedAt: string;
      /** Null when the event has no usable standings or schedule to plan against. */
      whatIf: RankingProjectionWhatIf | null;
      whatIfMessage: string | null;
    };

function setup(message: string, orgId: string | null, primary: "team" | "event" | "rankings"): RankingProjectionView {
  const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const team: RankingProjectionSetupStep = {
    id: "workspace",
    label: "Choose your team",
    detail: "Pick which FRC team you are working as.",
    href: "/workspace",
  };
  const event: RankingProjectionSetupStep = {
    id: "event",
    label: "Set active event",
    detail: "Rankings project from your active event's remaining qualification matches.",
    href: `/command${suffix}`,
  };
  const rankings: RankingProjectionSetupStep = {
    id: "rankings",
    label: "Open rankings",
    detail: "The saved ranking for your team at this event is what the projection starts from.",
    href: `/rankings${suffix}`,
  };
  const first = primary === "team" ? team : primary === "rankings" ? rankings : event;
  const steps = primary === "team" ? [team, event] : [first, team];
  return { status: "setup_required", message, orgId, steps };
}

type EventMetricRow = MetricRow & { epaTotal: number | null };

export type ProjectionRatingSource = "season" | "played" | "none";

function finiteRating(value: number | null | undefined): number | null {
  if (value == null) return null;
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : null;
}

/**
 * One scale for every robot in the projection.
 *
 * A saved season rating and a played-match rating are both in points, but they
 * are different estimates. Adding them inside one alliance can crown the wrong
 * side. Use the season rating only when every robot in the projection has one.
 * Otherwise rate each robot from matches already played, and leave a robot
 * with no played match unrated.
 */
export function ratingsForProjection(
  projectionTeams: readonly string[],
  metricRows: readonly { teamKey: string; epaTotal: number | null }[],
  playedMatchRatings: readonly { teamKey: string; total: number }[],
): { ratings: RatingMap; source: ProjectionRatingSource } {
  const season = new Map<string, number>();
  for (const row of metricRows) {
    if (!row?.teamKey) continue;
    const rating = finiteRating(row.epaTotal);
    if (rating != null) season.set(row.teamKey, rating);
  }
  const played = new Map<string, number>();
  for (const robot of playedMatchRatings) {
    if (!robot?.teamKey) continue;
    const rating = finiteRating(robot.total);
    if (rating != null) played.set(robot.teamKey, rating);
  }
  const teams = [...new Set(projectionTeams.filter((team) => typeof team === "string" && team))];
  const ratings: RatingMap = {};
  if (teams.length > 0 && teams.every((team) => season.has(team))) {
    for (const team of teams) ratings[team] = season.get(team)!;
    return { ratings, source: "season" };
  }
  let used = 0;
  for (const team of teams) {
    const rating = played.get(team);
    if (rating == null) continue;
    ratings[team] = rating;
    used += 1;
  }
  return { ratings, source: used > 0 ? "played" : "none" };
}

/** Shown only when the whole event is rated from matches already played. */
export const PLAYED_MATCH_RATING_CAVEAT =
  "Robots are rated from the points they scored in matches already played at this event.";

const EMPTY_EVENT_SCORING: EventScoring = { opr: [], averageAllianceScore: null, alliances: 0 };

/**
 * Played-match ratings for this event, or nothing.
 *
 * FACT: `loadEventScoring` already returns the empty object for zero played
 * matches, for a read that throws (its own savepoint), and when the points
 * cannot be solved. This catch is for a throw that escapes that savepoint.
 * Standings stay on the page and remaining matches stay unpredicted, instead
 * of the planner's savepoint discarding the schedule.
 */
async function eventScoringOrEmpty(client: PoolClient, eventKey: string): Promise<EventScoring> {
  try {
    return await loadEventScoring(client, eventKey);
  } catch {
    return EMPTY_EVENT_SCORING;
  }
}

function projectionTeamKeys(
  standings: readonly StandingTeam[],
  remaining: readonly { redAlliance: unknown; blueAlliance: unknown }[],
): string[] {
  const teams: string[] = [];
  for (const row of standings) teams.push(row.teamKey);
  for (const match of remaining) {
    teams.push(...allianceTeamKeys(match.redAlliance), ...allianceTeamKeys(match.blueAlliance));
  }
  return teams;
}

/**
 * Loads the cached inputs for the in-browser what-if planner. Every branch here
 * either returns real cached rows or an honest message — no synthesised teams,
 * no synthesised match outcomes.
 */
async function loadWhatIf(
  client: PoolClient,
  eventKey: string,
  eventYear: number | null,
): Promise<{ whatIf: RankingProjectionWhatIf | null; message: string | null }> {
  const rules = rankingPointRulesForYear(eventYear);
  const [metricsResult, remainingResult, playedResult] = await Promise.all([
    client.query<EventMetricRow>(
      `SELECT team_key AS "teamKey",
              COALESCE(max(rank) FILTER (WHERE source = 'tba'), max(rank)) AS rank,
              COALESCE(max(wins) FILTER (WHERE source = 'tba'), max(wins)) AS wins,
              COALESCE(max(losses) FILTER (WHERE source = 'tba'), max(losses)) AS losses,
              COALESCE(max(ties) FILTER (WHERE source = 'tba'), max(ties)) AS ties,
              COALESCE(max(epa_total) FILTER (WHERE source = 'statbotics'), max(epa_total)) AS "epaTotal"
         FROM team_event_metrics
        WHERE event_key = $1::text
        GROUP BY team_key`,
      [eventKey],
    ),
    client.query<{
      matchKey: string;
      matchNumber: number;
      redAlliance: unknown;
      blueAlliance: unknown;
    }>(
      `SELECT match_key AS "matchKey", match_number AS "matchNumber",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
         FROM matches_ref
        WHERE event_key = $1::text AND comp_level = 'qm' AND winning_alliance IS NULL
        ORDER BY match_number`,
      [eventKey],
    ),
    client.query<{
      matchKey: string;
      redAlliance: unknown;
      blueAlliance: unknown;
      scoreBreakdown: Record<string, unknown> | null;
    }>(
      `SELECT match_key AS "matchKey", red_alliance AS "redAlliance",
              blue_alliance AS "blueAlliance", score_breakdown AS "scoreBreakdown"
         FROM matches_ref
        WHERE event_key = $1::text AND comp_level = 'qm' AND winning_alliance IS NOT NULL`,
      [eventKey],
    ),
  ]);

  const metricRows = metricsResult.rows.filter(
    (metricRow) => typeof metricRow?.teamKey === "string" && metricRow.teamKey,
  );
  if (!metricRows.length) {
    return {
      whatIf: null,
      message:
        "No ranking rows for this event are saved yet. Sync this event, then plan a seed.",
    };
  }

  const official = rankingPointsFromPlayedMatches(
    playedResult.rows.filter((played) => typeof played?.matchKey === "string" && played.matchKey),
  );
  const { standings, rankingPointSource, excludedTeams } = buildStandings(
    metricRows,
    official.matchesWithRankingPoints > 0 ? official.byTeam : null,
    rules,
  );
  if (!standings.length) {
    return {
      whatIf: null,
      message: "Ranking rows are saved, but they have no win/loss record yet, so there is nothing to project.",
    };
  }

  // One scale for the event. The curve is applied below, not here.
  // buildRemainingMatches only needs the sign of the margin (an exact tie stays
  // unpredicted); a wider curve never flips which alliance is ahead.
  const eventScoring = await eventScoringOrEmpty(client, eventKey);
  const { ratings, source } = ratingsForProjection(
    projectionTeamKeys(standings, remainingResult.rows),
    metricRows,
    eventScoring.opr,
  );
  const remaining = buildRemainingMatches(remainingResult.rows, ratings);
  const unpredictedMatches = remaining.filter((match) => match.predicted == null).length;

  const caveats: string[] = [];
  if (!rules.confirmed) {
    caveats.push(
      `Assumes ${rules.win} ranking points for a win and ${rules.tie} for a tie; check this season's game manual.`,
    );
  }
  if (rankingPointSource === "record") {
    caveats.push(
      "Bonus ranking points already earned aren't counted: only wins and ties are saved for this event.",
    );
  }
  if (source === "played") caveats.push(PLAYED_MATCH_RATING_CAVEAT);
  if (excludedTeams.length) {
    caveats.push(
      `${excludedTeams.length} team${excludedTeams.length === 1 ? " has" : "s have"} no record yet and ${excludedTeams.length === 1 ? "is" : "are"} left out of the seed order.`,
    );
  }
  caveats.push(
    "Teams that finish level keep their current official order: this season's tiebreakers aren't modelled.",
  );

  const odds = remaining.length
    ? seedOdds({
        standings: standings.map((row) => ({
          teamKey: row.teamKey,
          rankingPoints: row.rankingPoints,
          played: row.played,
          currentRank: row.currentRank,
        })),
        remaining: remaining.map((match) => ({
          matchKey: match.matchKey,
          red: match.red,
          blue: match.blue,
          redWinProbability:
            match.redRating != null && match.blueRating != null
              ? allianceWinProbabilityForEvent(
                  match.redRating,
                  match.blueRating,
                  eventScoring.averageAllianceScore,
                )
              : null,
        })),
        rules,
      })
    : null;

  return {
    whatIf: {
      rules,
      rankingPointSource,
      standings,
      remaining,
      excludedTeams,
      unpredictedMatches,
      caveats,
      ratingSource: source,
      seedOdds: odds
        ? { iterations: odds.iterations, captains: odds.captains, teams: odds.teams, unpredictedMatches: odds.unpredictedMatches }
        : null,
    },
    message: remaining.length ? null : "Every qualification match is played — this is the final seed order.",
  };
}

export async function computeRankingProjectionView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<RankingProjectionView> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Choose your team to project rankings.", null, "team");
  if (!org.teamNumber) return setup("Set your team number so rankings can find your team.", org.orgId, "team");

  const context = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
    [org.orgId],
  );
  const eventKey = context.rows[0]?.eventKey ?? null;
  if (!eventKey) return setup("Connect an active event before projecting remaining qualification matches.", org.orgId, "event");

  const event = await client.query<{ name: string; year: number | null }>(
    `SELECT COALESCE(short_name, name) AS name, year FROM events_ref WHERE event_key = $1`,
    [eventKey],
  );
  if (!event.rows[0]) return setup("This event is not in the saved schedule yet. Set the active event again after it syncs.", org.orgId, "event");
  const eventYear = Number.isFinite(Number(event.rows[0].year)) ? Number(event.rows[0].year) : null;

  const teamKey = `frc${org.teamNumber}`;
  const [metrics, remaining, played] = await Promise.all([
    client.query<{ rank: number | null; wins: number | null; losses: number | null; ties: number | null; epaTotal: number | null }>(
      `SELECT rank, wins, losses, ties, epa_total AS "epaTotal"
       FROM team_event_metrics
       WHERE team_key = $1 AND event_key = $2
       ORDER BY CASE source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, synced_at DESC
       LIMIT 1`,
      [teamKey, eventKey],
    ),
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM matches_ref
       WHERE event_key = $1 AND comp_level = 'qm' AND winning_alliance IS NULL`,
      [eventKey],
    ),
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM matches_ref
       WHERE event_key = $1 AND comp_level = 'qm' AND winning_alliance IS NOT NULL`,
      [eventKey],
    ),
  ]);

  const row = metrics.rows[0];
  if (!row || row.rank == null) {
    return setup("No ranking is saved yet for your team at this event.", org.orgId, "rankings");
  }

  const record =
    row.wins == null ? null : `${row.wins}-${row.losses ?? 0}-${row.ties ?? 0}`;

  // The planner is additive: a failure here must never take the rank card down.
  // `.catch()` alone did not achieve that — the failed statement left the shared
  // transaction aborted, so the rank card's own reads were already done but the
  // request's COMMIT could not land whatever else it was going to write.
  const planner = await withSavepoint(client, () => loadWhatIf(client, eventKey, eventYear), {
    whatIf: null,
    message: "The remaining schedule could not be loaded. The rank above is still the saved one.",
  });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    teamKey,
    eventKey,
    eventName: event.rows[0].name,
    currentRank: row.rank,
    record,
    remainingQuals: Number(remaining.rows[0]?.count ?? 0),
    playedQuals: Number(played.rows[0]?.count ?? 0),
    epaTotal: row.epaTotal,
    computedAt: new Date().toISOString(),
    whatIf: planner.whatIf,
    whatIfMessage: planner.message,
  };
}
