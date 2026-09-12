import type { PoolClient } from "@neondatabase/serverless";
import { playoffReweighCue, summarizeRobotWeighIn } from ".";
import type { RobotWeighInEntry, RobotWeighInStation, RobotWeighInSummary } from "./types";

export const ROBOT_WEIGH_IN_STATIONS: RobotWeighInStation[] = [
  "shop",
  "event_inspection",
  "practice_field",
  "other",
];

export const DEFAULT_WEIGHT_LIMIT_LBS = 115;

export type RobotWeighInSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type RobotWeighInView =
  | {
      status: "setup_required";
      message: string;
      steps: RobotWeighInSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      entries: RobotWeighInEntry[];
      summary: RobotWeighInSummary;
      /** Org-configured competition weight limit for this season (weight-budget module), if set. */
      configuredLimitLbs: number | null;
      /** BOM-estimated robot mass = Σ(weight_lbs × quantity) from the weight-budget components. */
      bomEstimatedLbs: number | null;
      /** TBA unplayed qf/sf/f vs latest event_inspection day — null when schedule/cache is empty. */
      playoffReweighCue: string | null;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * Resolve the org's configured competition weight limit for a season from the existing
 * weight-budget module (`weight_settings`). Returns null when the org hasn't set one, so
 * callers fall back to the FRC default without fabricating a limit.
 */
export async function resolveConfiguredLimit(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<number | null> {
  const result = await client.query<{ limitLbs: string | number }>(
    `SELECT limit_lbs AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
    [orgId, seasonYear],
  );
  const raw = result.rows[0] ? Number(result.rows[0].limitLbs) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

type EntryRow = {
  id: string;
  weighedOn: string;
  weightLbs: string | number;
  weightLimitLbs: string | number;
  station: RobotWeighInStation;
  bumpersOn: boolean;
  batteryOn: boolean;
  seasonYear: number;
  notes: string | null;
};

function mapEntry(row: EntryRow): RobotWeighInEntry {
  return {
    id: row.id,
    weighedOn: row.weighedOn,
    weightLbs: Number(row.weightLbs) || 0,
    weightLimitLbs: Number(row.weightLimitLbs) || DEFAULT_WEIGHT_LIMIT_LBS,
    source: "weigh_in",
    station: row.station,
    bumpersOn: row.bumpersOn,
    batteryOn: row.batteryOn,
    configLabel: null,
    seasonYear: row.seasonYear,
    notes: row.notes,
  };
}

/** A weigh-in logged from Inspection (`robot_weights`, migration 0054). */
type InspectionWeightRow = {
  id: string;
  weighedOn: string;
  totalLbs: string | number;
  config: string | null;
  note: string | null;
};

function mapInspectionEntry(row: InspectionWeightRow, limitLbs: number): RobotWeighInEntry {
  const config = row.config?.trim() ? row.config.trim() : null;
  return {
    id: row.id,
    weighedOn: row.weighedOn,
    weightLbs: Number(row.totalLbs) || 0,
    weightLimitLbs: limitLbs,
    source: "inspection",
    // robot_weights stores a free-text config, not a station or bumper/battery flags.
    // Reporting them would be guessing, so they stay null and the UI says so.
    station: null,
    bumpersOn: null,
    batteryOn: null,
    configLabel: config,
    seasonYear: Number(row.weighedOn.slice(0, 4)) || 0,
    notes: row.note?.trim() ? row.note.trim() : null,
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

/**
 * Next unplayed TBA playoff (qf/sf/f) at the org's active event.
 * Missing tables, no active event, or no elims yet → null — never invent playoffs.
 */
async function loadNextUnplayedPlayoffAt(client: PoolClient, orgId: string): Promise<string | null> {
  try {
    const result = await client.query<{ playoffStartAt: string | null }>(
      `SELECT COALESCE(m.predicted_time, m.event_time)::text AS "playoffStartAt"
       FROM org_active_context c
       JOIN matches_ref m ON m.event_key = c.active_event_key
       WHERE c.org_id = $1::uuid
         AND c.active_event_key IS NOT NULL
         AND m.comp_level = ANY($2::text[])
         AND m.actual_time IS NULL
         AND COALESCE(m.predicted_time, m.event_time) IS NOT NULL
       ORDER BY COALESCE(m.predicted_time, m.event_time) NULLS LAST, m.match_number
       LIMIT 1`,
      [orgId, ["qf", "sf", "f"]],
    );
    return result.rows[0]?.playoffStartAt ?? null;
  } catch {
    return null;
  }
}

export async function computeRobotWeighInView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RobotWeighInView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to log robot weigh-ins.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [entryResult, seasonResult, limitResult, bomResult, inspectionResult, inspectionLimitResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, weighed_on::text AS "weighedOn", weight_lbs AS "weightLbs",
              weight_limit_lbs AS "weightLimitLbs", station, bumpers_on AS "bumpersOn",
              battery_on AS "batteryOn", season_year AS "seasonYear", notes
       FROM robot_weigh_in_entries
       WHERE org_id = $1 AND season_year = $2
       ORDER BY weighed_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM robot_weigh_in_entries WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    // Grounding: pull the org's configured limit + BOM estimate from the weight-budget module.
    client.query<{ limitLbs: string | number }>(
      `SELECT limit_lbs AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ bomLbs: string | number | null }>(
      `SELECT COALESCE(SUM(weight_lbs * quantity), 0) AS "bomLbs"
       FROM weight_components WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    // Weights logged from Inspection land in robot_weights (0054). They are the same
    // robot on the same scale, so the desk shows them instead of reporting "no entries"
    // while Inspection holds a reading. robot_weights has no season column — the
    // weigh date carries the season.
    client.query<InspectionWeightRow>(
      `SELECT id::text AS id, weighed_at::text AS "weighedOn", total_lbs AS "totalLbs",
              config, note
       FROM robot_weights
       WHERE org_id = $1::uuid
         AND EXTRACT(YEAR FROM weighed_at) = $2
       ORDER BY weighed_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ limitLbs: string | number | null }>(
      `SELECT weight_limit_lbs AS "limitLbs" FROM inspection_settings WHERE org_id = $1::uuid`,
      [org.orgId],
    ),
  ]);

  const inspectionLimitRaw = inspectionLimitResult.rows[0]
    ? Number(inspectionLimitResult.rows[0].limitLbs)
    : NaN;
  const budgetLimitRaw = limitResult.rows[0] ? Number(limitResult.rows[0].limitLbs) : NaN;
  // The mirrored log stores no limit of its own; use the org's configured one
  // (Inspection first, then the weight budget) before the FRC default.
  const mirroredLimitLbs =
    (Number.isFinite(inspectionLimitRaw) && inspectionLimitRaw > 0 ? inspectionLimitRaw : null) ??
    (Number.isFinite(budgetLimitRaw) && budgetLimitRaw > 0 ? budgetLimitRaw : null) ??
    DEFAULT_WEIGHT_LIMIT_LBS;

  const entries = [
    ...entryResult.rows.map(mapEntry),
    ...inspectionResult.rows.map((row) => mapInspectionEntry(row, mirroredLimitLbs)),
  ].sort((a, b) => b.weighedOn.localeCompare(a.weighedOn));
  const summary = summarizeRobotWeighIn(entries);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const configuredRaw = limitResult.rows[0] ? Number(limitResult.rows[0].limitLbs) : NaN;
  const configuredLimitLbs = Number.isFinite(configuredRaw) && configuredRaw > 0 ? configuredRaw : null;
  const bomRaw = bomResult.rows[0] ? Number(bomResult.rows[0].bomLbs) : 0;
  const bomEstimatedLbs = Number.isFinite(bomRaw) && bomRaw > 0 ? Math.round(bomRaw * 100) / 100 : null;

  const nextUnplayedPlayoffAt = await loadNextUnplayedPlayoffAt(client, org.orgId);
  const latestEventInspectionAt =
    entries.find((entry) => entry.station === "event_inspection")?.weighedOn ?? null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    entries,
    summary,
    configuredLimitLbs,
    bomEstimatedLbs,
    playoffReweighCue: playoffReweighCue({
      nextUnplayedPlayoffAt,
      latestEventInspectionAt,
      hasAnyEntry: entries.length > 0,
    }),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logWeighIn(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    weighedOn: string;
    weightLbs: number;
    weightLimitLbs: number;
    station: RobotWeighInStation;
    bumpersOn: boolean;
    batteryOn: boolean;
    seasonYear: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO robot_weigh_in_entries (
       org_id, weighed_on, weight_lbs, weight_limit_lbs, station, bumpers_on, battery_on,
       season_year, notes, logged_by
     ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.weighedOn,
      input.weightLbs,
      input.weightLimitLbs,
      input.station,
      input.bumpersOn,
      input.batteryOn,
      input.seasonYear,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteWeighIn(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM robot_weigh_in_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
