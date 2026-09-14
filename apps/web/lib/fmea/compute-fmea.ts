import type { PoolClient } from "@neondatabase/serverless";
import { batteryFmeaSignals, type BatteryFmeaSignal } from "../battery-reliability";
import { loadBatteryFleet } from "../load-battery-fleet";
import { evaluateFailure, summarizeFailures } from ".";
import type {
  FmeaContext,
  FmeaEvaluation,
  FmeaFailure,
  FmeaStatus,
  FmeaSummary,
} from "./types";
import { detectRepeatFailures, type RepeatFailureAlert } from "./repeat-failures";

export const FMEA_CONTEXTS: FmeaContext[] = ["match", "pit", "practice", "inspection", "other"];
export const FMEA_STATUSES: FmeaStatus[] = ["open", "fixing", "verified", "closed"];

export type FmeaSetupStep = { id: string; label: string; detail: string; href: string };

export type SubsystemOption = { id: string; name: string; robotLabel: string };
export type InspectionOption = { id: string; requirement: string; category: string; status: string };
export type InventoryOption = { id: string; name: string; category: string; subsystem: string | null };

export type FmeaView =
  | {
      status: "setup_required";
      message: string;
      steps: FmeaSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evaluations: FmeaEvaluation[];
      summary: FmeaSummary;
      /** CD #42 — subsystems with >=2 failures this season. */
      repeatAlerts: RepeatFailureAlert[];
      /** CD #48 — battery fleet reliability feeding FMEA (evidence-only). */
      batterySignals: BatteryFmeaSignal[];
      subsystems: SubsystemOption[];
      inspectionItems: InspectionOption[];
      inventoryItems: InventoryOption[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type FailureRow = {
  id: string;
  title: string;
  failureMode: string;
  context: FmeaContext;
  subsystemId: string | null;
  subsystemName: string;
  occurrence: number;
  severity: number;
  detection: number;
  rootCause: string | null;
  fiveWhys: string | null;
  fix: string | null;
  status: FmeaStatus;
  inspectionItemId: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  eventKey: string | null;
  matchKey: string | null;
  robotLabel: string;
  occurredAt: string;
  seasonYear: number;
  recordedByName: string | null;
};

function mapFailure(row: FailureRow): FmeaFailure {
  return {
    id: row.id,
    title: row.title,
    failureMode: row.failureMode ?? "",
    context: row.context,
    subsystemId: row.subsystemId,
    subsystemName: row.subsystemName,
    occurrence: Number(row.occurrence) || 1,
    severity: Number(row.severity) || 1,
    detection: Number(row.detection) || 1,
    rootCause: row.rootCause,
    fiveWhys: row.fiveWhys,
    fix: row.fix,
    status: row.status,
    inspectionItemId: row.inspectionItemId,
    inventoryItemId: row.inventoryItemId ?? null,
    inventoryItemName: row.inventoryItemName ?? null,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    robotLabel: row.robotLabel,
    occurredAt: row.occurredAt,
    seasonYear: row.seasonYear,
    recordedByName: row.recordedByName,
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

function isMissingInventoryItemColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42703" || /inventory_item_id|undefined_column/i.test(message);
}

async function assertInventoryItemInOrg(
  client: PoolClient,
  orgId: string,
  inventoryItemId: string,
): Promise<void> {
  const item = await client.query(
    `SELECT 1 FROM inventory_items WHERE id = $1 AND org_id = $2 AND archived = false`,
    [inventoryItemId, orgId],
  );
  if (!item.rowCount) throw new Error("Inventory item not found");
}

const FAILURES_SELECT_WITH_INVENTORY = `SELECT f.id, f.title, f.failure_mode AS "failureMode", f.context,
              f.subsystem_id AS "subsystemId", f.subsystem_name AS "subsystemName",
              f.occurrence, f.severity, f.detection,
              f.root_cause AS "rootCause", f.five_whys AS "fiveWhys", f.fix,
              f.status, f.inspection_item_id AS "inspectionItemId",
              f.inventory_item_id AS "inventoryItemId", i.name AS "inventoryItemName",
              f.event_key AS "eventKey", f.match_key AS "matchKey",
              f.robot_label AS "robotLabel", f.occurred_at::text AS "occurredAt",
              f.season_year AS "seasonYear", u.name AS "recordedByName"
       FROM fmea_failures f
       LEFT JOIN users u ON u.id = f.recorded_by
       LEFT JOIN inventory_items i ON i.id = f.inventory_item_id AND i.org_id = f.org_id
       WHERE f.org_id = $1 AND f.season_year = $2
       ORDER BY (f.occurrence * f.severity * f.detection) DESC, f.occurred_at DESC`;

const FAILURES_SELECT_WITHOUT_INVENTORY = `SELECT f.id, f.title, f.failure_mode AS "failureMode", f.context,
              f.subsystem_id AS "subsystemId", f.subsystem_name AS "subsystemName",
              f.occurrence, f.severity, f.detection,
              f.root_cause AS "rootCause", f.five_whys AS "fiveWhys", f.fix,
              f.status, f.inspection_item_id AS "inspectionItemId",
              NULL::uuid AS "inventoryItemId", NULL::text AS "inventoryItemName",
              f.event_key AS "eventKey", f.match_key AS "matchKey",
              f.robot_label AS "robotLabel", f.occurred_at::text AS "occurredAt",
              f.season_year AS "seasonYear", u.name AS "recordedByName"
       FROM fmea_failures f
       LEFT JOIN users u ON u.id = f.recorded_by
       WHERE f.org_id = $1 AND f.season_year = $2
       ORDER BY (f.occurrence * f.severity * f.detection) DESC, f.occurred_at DESC`;

async function loadFailures(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<FailureRow[]> {
  try {
    const result = await client.query<FailureRow>(FAILURES_SELECT_WITH_INVENTORY, [orgId, seasonYear]);
    return result.rows;
  } catch (error) {
    if (!isMissingInventoryItemColumn(error)) throw error;
    const result = await client.query<FailureRow>(FAILURES_SELECT_WITHOUT_INVENTORY, [orgId, seasonYear]);
    return result.rows;
  }
}

async function loadInventoryOptions(client: PoolClient, orgId: string): Promise<InventoryOption[]> {
  try {
    const result = await client.query<InventoryOption>(
      `SELECT id, name, category, subsystem
       FROM inventory_items
       WHERE org_id = $1 AND archived = false
       ORDER BY name
       LIMIT 200`,
      [orgId],
    );
    return result.rows;
  } catch {
    return [];
  }
}

export async function computeFmeaView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<FmeaView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to log structured failures against your subsystems.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [failureRows, seasonResult, subsystemResult, inspectionResult, fleet, inventoryItems] = await Promise.all([
    loadFailures(client, org.orgId, seasonYear),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM fmea_failures WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<SubsystemOption>(
      `SELECT id, name, robot_label AS "robotLabel"
       FROM robot_subsystems
       WHERE org_id = $1
       ORDER BY name
       LIMIT 200`,
      [org.orgId],
    ),
    client.query<InspectionOption>(
      `SELECT id, requirement, category, status
       FROM inspection_items
       WHERE org_id = $1 AND status IN ('fail', 'pending')
       ORDER BY sort_order, category, requirement
       LIMIT 100`,
      [org.orgId],
    ),
    loadBatteryFleet(client, org.orgId),
    loadInventoryOptions(client, org.orgId),
  ]);

  const failures = failureRows.map(mapFailure);
  const evaluations = failures.map((failure) => evaluateFailure(failure));
  const summary = summarizeFailures(failures);
  const repeatAlerts = detectRepeatFailures(failures, { seasonYear });
  const batterySignals = batteryFmeaSignals(fleet, org.orgId);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evaluations,
    summary,
    repeatAlerts,
    batterySignals,
    subsystems: subsystemResult.rows,
    inspectionItems: inspectionResult.rows,
    inventoryItems,
    computedAt: new Date().toISOString(),
  };
}

function clampScale(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value || 1)));
}

export async function createFailure(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    failureMode: string;
    context: FmeaContext;
    subsystemId: string | null;
    subsystemName: string;
    occurrence: number;
    severity: number;
    detection: number;
    rootCause: string | null;
    fiveWhys: string | null;
    fix: string | null;
    status: FmeaStatus;
    inspectionItemId: string | null;
    inventoryItemId?: string | null;
    eventKey: string | null;
    matchKey: string | null;
    robotLabel: string;
    occurredAt: string | null;
  },
): Promise<void> {
  let subsystemName = input.subsystemName.trim();
  const subsystemId = input.subsystemId;
  let robotLabel = input.robotLabel.trim() || "competition";

  if (subsystemId) {
    const linked = await client.query<{ name: string; robotLabel: string }>(
      `SELECT name, robot_label AS "robotLabel" FROM robot_subsystems WHERE id = $1 AND org_id = $2`,
      [subsystemId, input.orgId],
    );
    const row = linked.rows[0];
    if (!row) throw new Error("Subsystem not found");
    subsystemName = row.name;
    robotLabel = row.robotLabel || robotLabel;
  }

  if (!subsystemName) throw new Error("subsystem is required");

  if (input.inspectionItemId) {
    const item = await client.query(
      `SELECT 1 FROM inspection_items WHERE id = $1 AND org_id = $2`,
      [input.inspectionItemId, input.orgId],
    );
    if (!item.rowCount) throw new Error("Inspection item not found");
  }

  const inventoryItemId = input.inventoryItemId?.trim() || null;
  if (inventoryItemId) {
    await assertInventoryItemInOrg(client, input.orgId, inventoryItemId);
  }

  const insertWithInventory = `INSERT INTO fmea_failures
       (org_id, season_year, robot_label, subsystem_id, subsystem_name, title, failure_mode,
        context, event_key, match_key, occurrence, severity, detection,
        root_cause, five_whys, fix, status, inspection_item_id, inventory_item_id, occurred_at, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             COALESCE($20::timestamptz, now()), $21)`;
  const insertWithoutInventory = `INSERT INTO fmea_failures
       (org_id, season_year, robot_label, subsystem_id, subsystem_name, title, failure_mode,
        context, event_key, match_key, occurrence, severity, detection,
        root_cause, five_whys, fix, status, inspection_item_id, occurred_at, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             COALESCE($19::timestamptz, now()), $20)`;
  const sharedParams = [
    input.orgId,
    input.seasonYear,
    robotLabel,
    subsystemId,
    subsystemName,
    input.title,
    input.failureMode,
    input.context,
    input.eventKey,
    input.matchKey,
    clampScale(input.occurrence),
    clampScale(input.severity),
    clampScale(input.detection),
    input.rootCause,
    input.fiveWhys,
    input.fix,
    input.status,
    input.inspectionItemId,
  ];

  try {
    await client.query(insertWithInventory, [...sharedParams, inventoryItemId, input.occurredAt, input.userId]);
  } catch (error) {
    if (!isMissingInventoryItemColumn(error)) throw error;
    await client.query(insertWithoutInventory, [...sharedParams, input.occurredAt, input.userId]);
  }
}

export async function updateFailure(
  client: PoolClient,
  input: {
    orgId: string;
    failureId: string;
    title?: string;
    failureMode?: string;
    context?: FmeaContext;
    subsystemId?: string | null;
    subsystemName?: string;
    occurrence?: number;
    severity?: number;
    detection?: number;
    rootCause?: string | null;
    fiveWhys?: string | null;
    fix?: string | null;
    status?: FmeaStatus;
    inspectionItemId?: string | null;
    inventoryItemId?: string | null;
  },
): Promise<void> {
  const subsystemId = input.subsystemId;
  let subsystemName = input.subsystemName;

  if (subsystemId) {
    const linked = await client.query<{ name: string }>(
      `SELECT name FROM robot_subsystems WHERE id = $1 AND org_id = $2`,
      [subsystemId, input.orgId],
    );
    const row = linked.rows[0];
    if (!row) throw new Error("Subsystem not found");
    subsystemName = row.name;
  }

  if (input.inspectionItemId) {
    const item = await client.query(
      `SELECT 1 FROM inspection_items WHERE id = $1 AND org_id = $2`,
      [input.inspectionItemId, input.orgId],
    );
    if (!item.rowCount) throw new Error("Inspection item not found");
  }

  if (input.inventoryItemId) {
    await assertInventoryItemInOrg(client, input.orgId, input.inventoryItemId);
  }

  const updateParams = [
    input.failureId,
    input.orgId,
    input.title ?? null,
    input.failureMode ?? null,
    input.context ?? null,
    input.subsystemId !== undefined,
    subsystemId ?? null,
    subsystemName ?? null,
    input.occurrence == null ? null : clampScale(input.occurrence),
    input.severity == null ? null : clampScale(input.severity),
    input.detection == null ? null : clampScale(input.detection),
    input.rootCause !== undefined,
    input.rootCause ?? null,
    input.fiveWhys !== undefined,
    input.fiveWhys ?? null,
    input.fix !== undefined,
    input.fix ?? null,
    input.status ?? null,
    input.inspectionItemId !== undefined,
    input.inspectionItemId ?? null,
  ];
  const updateWithInventory = `UPDATE fmea_failures SET
       title = COALESCE($3, title),
       failure_mode = COALESCE($4, failure_mode),
       context = COALESCE($5, context),
       subsystem_id = CASE WHEN $6::boolean THEN $7 ELSE subsystem_id END,
       subsystem_name = COALESCE($8, subsystem_name),
       occurrence = COALESCE($9, occurrence),
       severity = COALESCE($10, severity),
       detection = COALESCE($11, detection),
       root_cause = CASE WHEN $12::boolean THEN $13 ELSE root_cause END,
       five_whys = CASE WHEN $14::boolean THEN $15 ELSE five_whys END,
       fix = CASE WHEN $16::boolean THEN $17 ELSE fix END,
       status = COALESCE($18, status),
       inspection_item_id = CASE WHEN $19::boolean THEN $20 ELSE inspection_item_id END,
       inventory_item_id = CASE WHEN $21::boolean THEN $22 ELSE inventory_item_id END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`;
  const updateWithoutInventory = `UPDATE fmea_failures SET
       title = COALESCE($3, title),
       failure_mode = COALESCE($4, failure_mode),
       context = COALESCE($5, context),
       subsystem_id = CASE WHEN $6::boolean THEN $7 ELSE subsystem_id END,
       subsystem_name = COALESCE($8, subsystem_name),
       occurrence = COALESCE($9, occurrence),
       severity = COALESCE($10, severity),
       detection = COALESCE($11, detection),
       root_cause = CASE WHEN $12::boolean THEN $13 ELSE root_cause END,
       five_whys = CASE WHEN $14::boolean THEN $15 ELSE five_whys END,
       fix = CASE WHEN $16::boolean THEN $17 ELSE fix END,
       status = COALESCE($18, status),
       inspection_item_id = CASE WHEN $19::boolean THEN $20 ELSE inspection_item_id END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`;

  try {
    const updated = await client.query(updateWithInventory, [
      ...updateParams,
      input.inventoryItemId !== undefined,
      input.inventoryItemId ?? null,
    ]);
    if (!updated.rowCount) throw new Error("Failure not found");
  } catch (error) {
    if (error instanceof Error && error.message === "Failure not found") throw error;
    if (!isMissingInventoryItemColumn(error)) throw error;
    const updated = await client.query(updateWithoutInventory, updateParams);
    if (!updated.rowCount) throw new Error("Failure not found", { cause: error });
  }
}

export async function deleteFailure(
  client: PoolClient,
  input: { orgId: string; failureId: string },
): Promise<void> {
  const deleted = await client.query(`DELETE FROM fmea_failures WHERE id = $1 AND org_id = $2`, [
    input.failureId,
    input.orgId,
  ]);
  if (!deleted.rowCount) throw new Error("Failure not found");
}
