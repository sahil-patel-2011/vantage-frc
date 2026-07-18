import type { PoolClient } from "@neondatabase/serverless";
import { buildAssetView, summarizeEquipment } from ".";
import type {
  EquipmentAsset,
  EquipmentAssetView,
  EquipmentCategory,
  EquipmentSummary,
  MaintenanceAction,
  MaintenanceLog,
} from "./types";

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = [
  "cnc",
  "mill",
  "lathe",
  "drill_press",
  "saw",
  "printer_3d",
  "laser",
  "welder",
  "hand_tool",
  "safety",
  "other",
];

export const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  "routine",
  "repair",
  "inspection",
  "calibration",
  "cleaning",
  "other",
];

export type EquipmentMaintenanceSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type EquipmentMaintenanceView =
  | {
      status: "setup_required";
      message: string;
      steps: EquipmentMaintenanceSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      assets: EquipmentAssetView[];
      logs: MaintenanceLog[];
      summary: EquipmentSummary;
      computedAt: string;
    };

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type AssetRow = {
  id: string;
  name: string;
  category: EquipmentCategory;
  location: string | null;
  intervalDays: number | null;
  notes: string | null;
  active: boolean;
};

type LogRow = {
  id: string;
  assetId: string;
  performedOn: string;
  action: MaintenanceAction;
  minutesSpent: number;
  notes: string | null;
};

function mapAsset(row: AssetRow): EquipmentAsset {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    intervalDays: row.intervalDays == null ? null : Number(row.intervalDays),
    notes: row.notes,
    active: row.active,
  };
}

function mapLog(row: LogRow): MaintenanceLog {
  return {
    id: row.id,
    assetId: row.assetId,
    performedOn: row.performedOn,
    action: row.action,
    minutesSpent: Number(row.minutesSpent) || 0,
    notes: row.notes,
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

export async function computeEquipmentMaintenanceView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<EquipmentMaintenanceView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track shop equipment maintenance.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [assetResult, logResult] = await Promise.all([
    client.query<AssetRow>(
      `SELECT id, name, category, location, interval_days AS "intervalDays", notes, active
       FROM equipment_maintenance_assets
       WHERE org_id = $1
       ORDER BY active DESC, name ASC`,
      [org.orgId],
    ),
    client.query<LogRow>(
      `SELECT id, asset_id AS "assetId", performed_on::text AS "performedOn", action,
              minutes_spent AS "minutesSpent", notes
       FROM equipment_maintenance_logs
       WHERE org_id = $1
       ORDER BY performed_on DESC, created_at DESC`,
      [org.orgId],
    ),
  ]);

  if (assetResult.rowCount === 0) {
    return {
      status: "setup_required",
      message: "Add your first piece of shop equipment to start tracking maintenance.",
      steps: [
        {
          id: "asset",
          label: "Add equipment",
          detail: "Log a mill, printer, saw, or other shop tool",
          href: "/equipment-maintenance",
        },
      ],
      orgId: org.orgId,
    };
  }

  const assets = assetResult.rows.map(mapAsset);
  const logs = logResult.rows.map(mapLog);
  const today = todayIso();
  const assetViews = assets.map((asset) => buildAssetView(asset, logs, today));
  const summary = summarizeEquipment(assetViews, logs);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    assets: assetViews,
    logs,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createAsset(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: EquipmentCategory;
    location: string | null;
    intervalDays: number | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO equipment_maintenance_assets (
       org_id, name, category, location, interval_days, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.orgId, input.name, input.category, input.location, input.intervalDays, input.notes, input.userId],
  );
}

export async function setAssetActive(
  client: PoolClient,
  input: { orgId: string; assetId: string; active: boolean },
): Promise<void> {
  await client.query(
    `UPDATE equipment_maintenance_assets SET active = $1 WHERE id = $2 AND org_id = $3`,
    [input.active, input.assetId, input.orgId],
  );
}

export async function deleteAsset(
  client: PoolClient,
  input: { orgId: string; assetId: string },
): Promise<void> {
  await client.query(`DELETE FROM equipment_maintenance_assets WHERE id = $1 AND org_id = $2`, [
    input.assetId,
    input.orgId,
  ]);
}

export async function logMaintenance(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    assetId: string;
    performedOn: string;
    action: MaintenanceAction;
    minutesSpent: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO equipment_maintenance_logs (
       org_id, asset_id, performed_on, action, minutes_spent, notes, logged_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7)`,
    [
      input.orgId,
      input.assetId,
      input.performedOn,
      input.action,
      Math.max(0, Math.round(input.minutesSpent)),
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteLog(
  client: PoolClient,
  input: { orgId: string; logId: string },
): Promise<void> {
  await client.query(`DELETE FROM equipment_maintenance_logs WHERE id = $1 AND org_id = $2`, [
    input.logId,
    input.orgId,
  ]);
}
