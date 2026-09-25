/**
 * Our alliance's autonomous routes, together: each robot's latest scouted route (an "Auto route"
 * question on the match form) and the places two of them would be in the same cell at the same
 * point in autonomous. Pure except for loadAllianceAutoRoutes, which reads under RLS.
 *
 * Timing is not scouted, only the order of the stops, so a route is spread evenly over the 15
 * seconds and the conflicts are "probably", said as such. Nothing is invented: a team with no
 * route scouted at this event shows none.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  fieldPositionCellLabel,
  fieldPositionConfig,
  normalizeAutoPath,
  type FieldDefinition,
  type FieldPositionConfig,
} from "@vantage/scouting";

export type AutoRoute = {
  teamKey: string;
  /** Grid cells in the order the robot reached them. */
  route: number[];
  matchKey: string | null;
  grid: Pick<FieldPositionConfig, "gridCols" | "gridRows">;
};

export type AutoRouteConflict = {
  teams: [string, string];
  cell: number;
  cellLabel: string;
  /** How far into autonomous, 0–1. */
  at: number;
};

type EntryRow = {
  teamKey: string;
  matchKey: string | null;
  payload: Record<string, unknown> | null;
  definition: { fields?: FieldDefinition[] } | null;
};

/** The newest non-empty route per team, from entries already sorted newest first. */
export function latestAutoRoutes(rows: readonly EntryRow[], teamKeys: readonly string[]): AutoRoute[] {
  const out = new Map<string, AutoRoute>();
  for (const row of rows) {
    if (out.has(row.teamKey) || !teamKeys.includes(row.teamKey)) continue;
    const fields = (row.definition?.fields ?? []).filter((field) => field?.type === "auto_path");
    for (const field of fields) {
      const config = fieldPositionConfig(field);
      const route = normalizeAutoPath(row.payload?.[field.key], config);
      if (route.length < 2) continue;
      out.set(row.teamKey, {
        teamKey: row.teamKey,
        route,
        matchKey: row.matchKey,
        grid: { gridCols: config.gridCols, gridRows: config.gridRows },
      });
      break;
    }
  }
  return teamKeys.map((key) => out.get(key)).filter((route): route is AutoRoute => Boolean(route));
}

/** Where a route is at a point in autonomous (0–1): the last stop it has reached. */
export function cellAt(route: readonly number[], at: number): number {
  if (route.length === 0) return -1;
  const index = Math.min(route.length - 1, Math.max(0, Math.floor(at * (route.length - 1) + 1e-9)));
  return route[index]!;
}

/**
 * Pairs of robots in the same cell at the same moment, sampled through autonomous. One entry per
 * pair and cell (the first moment it happens), so a shared start zone is reported once.
 */
export function autoRouteConflicts(routes: readonly AutoRoute[], samples = 30): AutoRouteConflict[] {
  const out: AutoRouteConflict[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < routes.length; a += 1) {
    for (let b = a + 1; b < routes.length; b += 1) {
      const left = routes[a]!;
      const right = routes[b]!;
      if (left.grid.gridCols !== right.grid.gridCols || left.grid.gridRows !== right.grid.gridRows) continue;
      for (let step = 0; step <= samples; step += 1) {
        const at = step / samples;
        const cell = cellAt(left.route, at);
        if (cell < 0 || cell !== cellAt(right.route, at)) continue;
        const key = `${left.teamKey}|${right.teamKey}|${cell}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          teams: [left.teamKey, right.teamKey],
          cell,
          cellLabel: fieldPositionCellLabel(cell, left.grid),
          at,
        });
      }
    }
  }
  return out;
}

export type AutoRouteNearMiss = {
  teams: [string, string];
  cell: number;
  cellLabel: string;
  /** Seconds between the two robots being in that cell. */
  secondsApart: number;
};

/**
 * Two robots through the same cell a few seconds apart: not a crash by the evenly spread timing,
 * but close enough that a slower auto turns it into one ("1323 and 6925 both pass through B2,
 * about 4 s apart"). Pairs and cells already reported as conflicts are left out.
 */
export function autoRouteNearMisses(
  routes: readonly AutoRoute[],
  conflicts: readonly AutoRouteConflict[] = autoRouteConflicts(routes),
  withinSeconds = 5,
): AutoRouteNearMiss[] {
  const clash = new Set(conflicts.map((conflict) => `${conflict.teams.join("|")}|${conflict.cell}`));
  const when = (route: readonly number[], cell: number) =>
    route.map((stop, index) => (stop === cell ? (route.length > 1 ? index / (route.length - 1) : 0) * 15 : null)).filter((t): t is number => t != null);
  const out: AutoRouteNearMiss[] = [];
  for (let a = 0; a < routes.length; a += 1) {
    for (let b = a + 1; b < routes.length; b += 1) {
      const left = routes[a]!;
      const right = routes[b]!;
      if (left.grid.gridCols !== right.grid.gridCols || left.grid.gridRows !== right.grid.gridRows) continue;
      for (const cell of new Set(left.route.filter((stop) => right.route.includes(stop)))) {
        if (clash.has(`${left.teamKey}|${right.teamKey}|${cell}`)) continue;
        let best = Infinity;
        for (const x of when(left.route, cell)) for (const y of when(right.route, cell)) best = Math.min(best, Math.abs(x - y));
        if (best <= withinSeconds) {
          out.push({ teams: [left.teamKey, right.teamKey], cell, cellLabel: fieldPositionCellLabel(cell, left.grid), secondsApart: Math.max(1, Math.round(best)) });
        }
      }
    }
  }
  return out;
}

/** "About 5 s in": a point in autonomous said the way a drive coach would. */
export function secondsIntoAuto(at: number): string {
  return `about ${Math.round(at * 15)} s in`;
}

/** The latest scouted auto route for each of these teams at this event, newest report first. */
export async function loadAllianceAutoRoutes(
  client: PoolClient,
  input: { orgId: string; eventKey: string; teamKeys: string[] },
): Promise<AutoRoute[]> {
  if (!input.teamKeys.length) return [];
  const result = await client.query<EntryRow>(
    `SELECT e.team_key AS "teamKey", e.match_key AS "matchKey", e.payload, s.schema AS definition
       FROM match_scout_entries e
       JOIN scout_schemas s ON s.id = e.schema_id
      WHERE e.org_id = $1::uuid
        AND e.event_key = $2
        AND e.team_key = ANY($3::text[])
        AND s.schema::text LIKE '%"auto_path"%'
      ORDER BY e.updated_at DESC
      LIMIT 300`,
    [input.orgId, input.eventKey, input.teamKeys],
  );
  return latestAutoRoutes(result.rows, input.teamKeys);
}
