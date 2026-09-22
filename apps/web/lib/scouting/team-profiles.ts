import type { PoolClient } from "@neondatabase/serverless";
import {
  MIN_MATCHES_TO_STAND_ALONE,
  pickListOrder,
  pickListRowsFromScouting,
  profilesFromScouting,
  rankByWeightedZScores,
  scoutingPicklistWeights,
  type MetricWeight,
  type ScoutedTeamProfile,
} from "@vantage/prediction-strategy";
import type { FormulaExpression } from "@vantage/scouting";
import { scoutedRowsFromEntries, type OrgValueFormula } from "./scouted-ratings";

/**
 * What a weekend of tablets actually adds up to.
 *
 * `profilesFromScouting` — averages, spread, trend, percentile, a sparkline
 * series and a headline — has existed and been tested for a while, and so has
 * `scoutedRowsFromEntries`, the bridge that turns a scouting payload into
 * points using the team's own value formula. Neither was reachable: no route
 * called either one, so every number a team collected stayed a row in a table
 * and the product could only show you how *much* you had scouted, never what
 * it said.
 *
 * This is the missing middle. It reads the entries, applies the formula, and
 * returns the profiles — with the pick-list order alongside, because "who
 * should we take" is the question the data is collected to answer.
 */

export type TeamProfilesView =
  | {
      status: "ready";
      eventKey: string;
      /** Every team with at least one scouted match, best first. */
      profiles: ScoutedTeamProfile[];
      /** Only the teams watched enough times to rank. */
      pickOrder: ScoutedTeamProfile[];
      /**
       * The same robots, ordered by what this team said it is looking for.
       *
       * The weighted ranking has always existed; it was fed four EPA numbers
       * and nothing a scout ever wrote down. This is the order the scouting
       * produces, which is the only order there is at an off-season event.
       */
      weighted: { teamKey: string; score: number | null }[];
      /** How the points were derived, for the screen to say so. */
      basis: "phase" | "total";
      /** Teams seen, but not enough times to rank yet. */
      thin: number;
    }
  | { status: "empty"; eventKey: string | null; message: string }
  | { status: "needs_formula"; eventKey: string | null; message: string };

type EntryRow = {
  teamKey: string;
  matchKey: string;
  payload: Record<string, unknown>;
};

type FormulaRow = { name: string; expression: unknown };

/**
 * A formula row is stored as jsonb and read back as `unknown`. Anything that
 * is not an object is not an expression, and passing it on would blow up
 * inside the evaluator with a message about a property rather than about a
 * formula somebody wrote.
 */
function usableFormulas(rows: readonly FormulaRow[]): OrgValueFormula[] {
  const out: OrgValueFormula[] = [];
  for (const row of rows) {
    if (!row.expression || typeof row.expression !== "object") continue;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    out.push({ name: row.name, expression: row.expression as FormulaExpression });
  }
  return out;
}

export async function loadTeamProfiles(
  client: PoolClient,
  input: { orgId: string; eventKey: string | null },
): Promise<TeamProfilesView> {
  if (!input.eventKey) {
    return {
      status: "empty",
      eventKey: null,
      message: "Choose an event to see what your scouting says about these robots.",
    };
  }

  const [entries, formulas] = await Promise.all([
    client.query<EntryRow>(
      `SELECT team_key AS "teamKey", match_key AS "matchKey", payload
         FROM match_scout_entries
        WHERE org_id = $1::uuid AND event_key = $2
        ORDER BY match_key, team_key`,
      [input.orgId, input.eventKey],
    ),
    client.query<FormulaRow>(
      `SELECT name, expression FROM org_value_formulas WHERE org_id = $1::uuid ORDER BY name`,
      [input.orgId],
    ),
  ]);

  if (entries.rows.length === 0) {
    return {
      status: "empty",
      eventKey: input.eventKey,
      message: "Nobody has scouted a match at this event yet.",
    };
  }

  const converted = scoutedRowsFromEntries(entries.rows, usableFormulas(formulas.rows));
  if (!converted.ok) {
    return {
      status: "needs_formula",
      eventKey: input.eventKey,
      // The bridge already writes a sentence naming what is missing and why —
      // repeating it here in different words would be a second source of truth
      // about the same gap.
      message: converted.reason,
    };
  }

  const profiles = profilesFromScouting(converted.rows);
  const pickOrder = pickListOrder(profiles);
  const weighted = rankByWeightedZScores(
    pickListRowsFromScouting(profiles),
    scoutingPicklistWeights() as MetricWeight[],
  ).map((row) => ({ teamKey: row.teamKey, score: row.score }));
  return {
    status: "ready",
    eventKey: input.eventKey,
    profiles,
    pickOrder,
    weighted,
    basis: converted.basis,
    thin: profiles.filter((profile) => profile.matches < MIN_MATCHES_TO_STAND_ALONE).length,
  };
}
