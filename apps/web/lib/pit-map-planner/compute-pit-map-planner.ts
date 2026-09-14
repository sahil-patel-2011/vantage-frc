import type { PoolClient } from "@neondatabase/serverless";
import { PIT_MAP_CATEGORIES, summarizePitMap } from ".";
import type { PitMapItem, PitMapItemCategory, PitMapLayout, PitMapSummary } from "./types";

export { PIT_MAP_CATEGORIES };

export type PitMapPlannerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PitMapPlannerView =
  | {
      status: "setup_required";
      message: string;
      steps: PitMapPlannerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      layout: PitMapLayout | null;
      items: PitMapItem[];
      summary: PitMapSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isCategory(value: unknown): value is PitMapItemCategory {
  return typeof value === "string" && (PIT_MAP_CATEGORIES as string[]).includes(value);
}

type LayoutRow = {
  footprintWidthFt: string;
  footprintDepthFt: string;
  powerCapacityAmps: string;
  notes: string | null;
  updatedAt: string;
};

function mapLayout(row: LayoutRow): PitMapLayout {
  return {
    footprintWidthFt: Number(row.footprintWidthFt) || 0,
    footprintDepthFt: Number(row.footprintDepthFt) || 0,
    powerCapacityAmps: Number(row.powerCapacityAmps) || 0,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

type ItemRow = {
  id: string;
  name: string;
  category: string;
  xFt: string;
  yFt: string;
  widthFt: string;
  depthFt: string;
  powerDrawAmps: string;
  notes: string | null;
  createdAt: string;
};

function mapItem(row: ItemRow): PitMapItem {
  return {
    id: row.id,
    name: row.name,
    category: isCategory(row.category) ? row.category : "other",
    xFt: Number(row.xFt) || 0,
    yFt: Number(row.yFt) || 0,
    widthFt: Number(row.widthFt) || 0,
    depthFt: Number(row.depthFt) || 0,
    powerDrawAmps: Number(row.powerDrawAmps) || 0,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computePitMapPlannerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<PitMapPlannerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to plan your pit map.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [layoutResult, itemResult, seasonResult] = await Promise.all([
    client.query<LayoutRow>(
      `SELECT footprint_width_ft AS "footprintWidthFt", footprint_depth_ft AS "footprintDepthFt",
              power_capacity_amps AS "powerCapacityAmps", notes, updated_at::text AS "updatedAt"
       FROM pit_map_planner_layouts
       WHERE org_id = $1 AND season_year = $2
       LIMIT 1`,
      [org.orgId, seasonYear],
    ),
    client.query<ItemRow>(
      `SELECT id, name, category, x_ft AS "xFt", y_ft AS "yFt", width_ft AS "widthFt",
              depth_ft AS "depthFt", power_draw_amps AS "powerDrawAmps", notes,
              created_at::text AS "createdAt"
       FROM pit_map_planner_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM pit_map_planner_items WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM pit_map_planner_layouts WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const layout = layoutResult.rows[0] ? mapLayout(layoutResult.rows[0]) : null;
  const items = itemResult.rows.map(mapItem);
  const summary = summarizePitMap(items, layout);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    layout,
    items,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertLayout(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    footprintWidthFt: number;
    footprintDepthFt: number;
    powerCapacityAmps: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO pit_map_planner_layouts (
       org_id, season_year, footprint_width_ft, footprint_depth_ft, power_capacity_amps, notes, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       footprint_width_ft = EXCLUDED.footprint_width_ft,
       footprint_depth_ft = EXCLUDED.footprint_depth_ft,
       power_capacity_amps = EXCLUDED.power_capacity_amps,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      input.seasonYear,
      Math.max(0.1, input.footprintWidthFt),
      Math.max(0.1, input.footprintDepthFt),
      Math.max(0, input.powerCapacityAmps),
      input.notes,
      input.userId,
    ],
  );
}

export async function addItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    name: string;
    category: PitMapItemCategory;
    xFt: number;
    yFt: number;
    widthFt: number;
    depthFt: number;
    powerDrawAmps: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO pit_map_planner_items (
       org_id, season_year, name, category, x_ft, y_ft, width_ft, depth_ft, power_draw_amps, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.orgId,
      input.seasonYear,
      input.name,
      input.category,
      input.xFt,
      input.yFt,
      Math.max(0.1, input.widthFt),
      Math.max(0.1, input.depthFt),
      Math.max(0, input.powerDrawAmps),
      input.notes,
      input.userId,
    ],
  );
}

export async function updateItemPosition(
  client: PoolClient,
  input: { orgId: string; itemId: string; xFt: number; yFt: number },
): Promise<void> {
  await client.query(`UPDATE pit_map_planner_items SET x_ft = $1, y_ft = $2 WHERE id = $3 AND org_id = $4`, [
    input.xFt,
    input.yFt,
    input.itemId,
    input.orgId,
  ]);
}

export async function deleteItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM pit_map_planner_items WHERE id = $1 AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
}
