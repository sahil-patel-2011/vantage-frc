import type { PoolClient } from "@neondatabase/serverless";
import { watchlistTeamKeys } from "./order";

/**
 * Distinct opponent_watchlist_entries team keys for this org, oldest-first.
 *
 * Coverage is org-scoped, so a threat anyone on the team flagged jumps the scout queue — not only
 * the caller's personal list. Degrades to [] when the table is missing so coverage still renders
 * in schedule order instead of taking the board down.
 */
export async function loadWatchlistTeamKeys(client: PoolClient, orgId: string): Promise<string[]> {
  try {
    const result = await client.query<{ teamKey: string }>(
      `SELECT team_key AS "teamKey"
         FROM opponent_watchlist_entries
        WHERE org_id = $1::uuid
        GROUP BY team_key
        ORDER BY MIN(created_at) ASC, team_key`,
      [orgId],
    );
    return watchlistTeamKeys(result.rows);
  } catch {
    return [];
  }
}
