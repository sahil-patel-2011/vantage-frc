import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
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

export type RankingProjectionSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/**
 * Everything the in-browser Best Path planner needs. Built from cached TBA rows
 * only: standings the event actually published, the unplayed schedule, and a
 * per-match prediction that is null whenever a robot has no cached rating.
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

function setup(message: string, orgId: string | null): RankingProjectionView {
  const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  return {
    status: "setup_required",
    message,
    orgId,
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      {
        id: "event",
        label: "Set active event",
        detail: "Rankings project from your active event's remaining qualification matches.",
        href: `/command${suffix}`,
      },
    ],
  };
}

type EventMetricRow = MetricRow & { epaTotal: number | null };

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
        "No ranking rows for this event are cached yet — sync live data before planning a seed path.",
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
      message: "Ranking rows are cached but carry no win/loss record yet, so there is nothing to project.",
    };
  }

  const ratings: RatingMap = {};
  for (const metricRow of metricRows) ratings[metricRow.teamKey] = metricRow.epaTotal ?? null;
  const remaining = buildRemainingMatches(remainingResult.rows, ratings);
  const unpredictedMatches = remaining.filter((match) => match.predicted == null).length;

  const caveats: string[] = [];
  if (!rules.confirmed) {
    caveats.push(
      `Ranking-point values for this season are not confirmed in Vantage (${rules.label}). Check the game manual before trusting the totals.`,
    );
  }
  if (rankingPointSource === "record") {
    caveats.push(
      "Banked ranking points come from win/tie records — the cache has no official per-match RP, so bonus RPs already earned are not included.",
    );
  }
  if (unpredictedMatches) {
    caveats.push(
      `${unpredictedMatches} remaining match${unpredictedMatches === 1 ? "" : "es"} have no prediction because a robot has no cached rating. Toggle them by hand.`,
    );
  }
  if (excludedTeams.length) {
    caveats.push(
      `${excludedTeams.length} team${excludedTeams.length === 1 ? "" : "s"} at this event have no record to project and are left out of the seed order.`,
    );
  }
  caveats.push(
    "Projected ties fall back to the current official rank — Vantage does not model this season's sort-order tiebreakers.",
  );

  return {
    whatIf: {
      rules,
      rankingPointSource,
      standings,
      remaining,
      excludedTeams,
      unpredictedMatches,
      caveats,
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
  if (!org) return setup("Choose your team to project rankings.", null);
  if (!org.teamNumber) return setup("Set your team number so rankings can find your TBA row.", org.orgId);

  const context = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
    [org.orgId],
  );
  const eventKey = context.rows[0]?.eventKey ?? null;
  if (!eventKey) return setup("Connect an active event before projecting remaining qualification matches.", org.orgId);

  const event = await client.query<{ name: string; year: number | null }>(
    `SELECT COALESCE(short_name, name) AS name, year FROM events_ref WHERE event_key = $1`,
    [eventKey],
  );
  if (!event.rows[0]) return setup("Active event is not in the TBA cache yet — sync live data first.", org.orgId);
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
    return setup("No TBA ranking row yet for your team at this event.", org.orgId);
  }

  const record =
    row.wins == null ? null : `${row.wins}-${row.losses ?? 0}-${row.ties ?? 0}`;

  // The planner is additive: a failure here must never take the rank card down.
  // `.catch()` alone did not achieve that — the failed statement left the shared
  // transaction aborted, so the rank card's own reads were already done but the
  // request's COMMIT could not land whatever else it was going to write.
  const planner = await withSavepoint(client, () => loadWhatIf(client, eventKey, eventYear), {
    whatIf: null,
    message: "Could not load the remaining schedule for what-if planning.",
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
