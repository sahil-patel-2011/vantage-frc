import type { PoolClient } from "@neondatabase/serverless";
import { MAX_SEASONS_COUNTED, type SeasonScale } from "@vantage/prediction-strategy";

/**
 * Every team's season ratings summarised per year (mean, spread, count), so a past game's rating
 * can be read on this season's scale (packages/prediction-strategy/src/season-scale.ts).
 *
 * The numbers are global (shared reference table, one ingest worker) and only move when a season
 * sync lands, so one read per instance per hour serves every team and every request.
 */
export const SEASON_SCALE_TTL_MS = 60 * 60 * 1000;
let memo: { at: number; key: number; scales: Promise<SeasonScale[]> } | null = null;

export function resetSeasonScaleMemo() {
  memo = null;
}

export async function loadSeasonScales(client: PoolClient, currentYear: number): Promise<SeasonScale[]> {
  const now = Date.now();
  if (!memo || memo.key !== currentYear || now - memo.at >= SEASON_SCALE_TTL_MS) {
    const scales = readScales(client, currentYear);
    memo = { at: now, key: currentYear, scales };
    scales.catch(() => {
      if (memo?.scales === scales) memo = null;
    });
  }
  return memo.scales;
}

async function readScales(client: PoolClient, currentYear: number): Promise<SeasonScale[]> {
  try {
    const result = await client.query<{ year: number; mean: number | null; sd: number | null; teams: number }>(
      `SELECT year,
              avg(epa_total)::float8 AS mean,
              stddev_samp(epa_total)::float8 AS sd,
              count(*)::int AS teams
         FROM team_year_metrics
        WHERE source = 'statbotics'
          AND epa_total IS NOT NULL
          AND year BETWEEN $1::int AND $2::int
        GROUP BY year
        ORDER BY year`,
      [currentYear - (MAX_SEASONS_COUNTED - 1), currentYear],
    );
    return result.rows
      .filter((row) => row.mean != null && row.sd != null)
      .map((row) => ({ year: Number(row.year), mean: Number(row.mean), sd: Number(row.sd), teams: Number(row.teams) }));
  } catch {
    // No statistics means ratings are used as stored, the same as before this existed.
    return [];
  }
}
