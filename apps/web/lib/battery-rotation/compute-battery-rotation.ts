import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { buildRotationSlots, computeBatteryHealth, summarizeRotation } from ".";
import type {
  BatteryHealth,
  BatteryReading,
  BatteryRecord,
  BatteryStatus,
  MatchAssignment,
  RotationSlot,
  RotationSummary,
} from "./types";

export const BATTERY_STATUSES: BatteryStatus[] = ["active", "charging", "short_pack", "retired"];

export type BatterySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type BatteryRotationView =
  | {
      status: "setup_required";
      message: string;
      steps: BatterySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      batteries: BatteryHealth[];
      readings: BatteryReading[];
      slots: RotationSlot[];
      summary: RotationSummary;
      computedAt: string;
    };

type BatteryRow = {
  id: string;
  label: string;
  serialNumber: string | null;
  status: BatteryStatus;
  purchasedOn: string | null;
  notes: string | null;
  createdAt: string;
};

type ReadingRow = {
  id: string;
  batteryId: string;
  recordedAt: string;
  internalResistanceMohm: string;
  voltage: string | null;
  cycleCount: number | null;
  notes: string | null;
};

type AssignmentRow = {
  id: string;
  batteryId: string;
  batteryLabel: string;
  matchLabel: string;
  scheduledAt: string;
  chargeMinutesAvailable: number;
};

function mapBattery(row: BatteryRow): BatteryRecord {
  return {
    id: row.id,
    label: row.label,
    serialNumber: row.serialNumber,
    status: row.status,
    purchasedOn: row.purchasedOn,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function mapReading(row: ReadingRow): BatteryReading {
  return {
    id: row.id,
    batteryId: row.batteryId,
    recordedAt: row.recordedAt,
    internalResistanceMohm: Number(row.internalResistanceMohm) || 0,
    voltage: row.voltage != null ? Number(row.voltage) : null,
    cycleCount: row.cycleCount,
    notes: row.notes,
  };
}

function mapAssignment(row: AssignmentRow): MatchAssignment {
  return {
    id: row.id,
    batteryId: row.batteryId,
    batteryLabel: row.batteryLabel,
    matchLabel: row.matchLabel,
    scheduledAt: row.scheduledAt,
    chargeMinutesAvailable: Number(row.chargeMinutesAvailable) || 0,
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

export async function computeBatteryRotationView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<BatteryRotationView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message:
        "Select a team workspace to plan battery rotation and charge scheduling — never DEMO IR or charge metrics.",
      steps: [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose your team organization — Battery Rotation is org-scoped.",
          href: "/workspace",
        },
        {
          id: "batteries",
          label: "Open Batteries",
          detail: "IR and cycles stay blank until logged — never DEMO health scores.",
          href: hubHref("/team", "batteries", null),
        },
        {
          id: "battery-health-forecast",
          label: "Open Health Forecast",
          detail: "Retirement projections stay blank until IR history exists — never DEMO EOL dates.",
          href: hubHref("/build", "battery-health-forecast", null),
        },
        {
          id: "pit",
          label: "Open Pit Command",
          detail: "Event-day rack status stays empty until packs are tracked — never DEMO volts.",
          href: withOrgHref("/pit", null),
        },
      ],
      orgId: null,
    };
  }

  const [batteryResult, readingResult, assignmentResult] = await Promise.all([
    client.query<BatteryRow>(
      `SELECT id, label, serial_number AS "serialNumber", status,
              purchased_on::text AS "purchasedOn", notes, created_at::text AS "createdAt"
       FROM battery_rotation_batteries
       WHERE org_id = $1
       ORDER BY label`,
      [org.orgId],
    ),
    client.query<ReadingRow>(
      `SELECT id, battery_id AS "batteryId", recorded_at::text AS "recordedAt",
              internal_resistance_mohm::text AS "internalResistanceMohm",
              voltage::text AS "voltage", cycle_count AS "cycleCount", notes
       FROM battery_rotation_readings
       WHERE org_id = $1
       ORDER BY recorded_at DESC
       LIMIT 500`,
      [org.orgId],
    ),
    client.query<AssignmentRow>(
      `SELECT a.id, a.battery_id AS "batteryId", b.label AS "batteryLabel",
              a.match_label AS "matchLabel", a.scheduled_at::text AS "scheduledAt",
              a.charge_minutes_available AS "chargeMinutesAvailable"
       FROM battery_rotation_assignments a
       JOIN battery_rotation_batteries b ON b.id = a.battery_id
       WHERE a.org_id = $1 AND a.scheduled_at >= now() - interval '1 day'
       ORDER BY a.scheduled_at ASC
       LIMIT 200`,
      [org.orgId],
    ),
  ]);

  const batteryRecords = batteryResult.rows.map(mapBattery);
  const readings = readingResult.rows.map(mapReading);
  const assignments = assignmentResult.rows.map(mapAssignment);

  const batteries = batteryRecords.map((battery) => computeBatteryHealth(battery, readings));
  const healthByBatteryId = new Map(batteries.map((b) => [b.batteryId, b]));
  const slots = buildRotationSlots(assignments, healthByBatteryId);
  const summary = summarizeRotation(batteries, slots);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    batteries,
    readings,
    slots,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addBattery(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    label: string;
    serialNumber: string | null;
    status: BatteryStatus;
    purchasedOn: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO battery_rotation_batteries (org_id, label, serial_number, status, purchased_on, notes, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7)`,
    [input.orgId, input.label, input.serialNumber, input.status, input.purchasedOn, input.notes, input.userId],
  );
}

export async function updateBatteryStatus(
  client: PoolClient,
  input: { orgId: string; batteryId: string; status: BatteryStatus },
): Promise<void> {
  await client.query(
    `UPDATE battery_rotation_batteries SET status = $1 WHERE id = $2 AND org_id = $3`,
    [input.status, input.batteryId, input.orgId],
  );
}

export async function deleteBattery(
  client: PoolClient,
  input: { orgId: string; batteryId: string },
): Promise<void> {
  await client.query(`DELETE FROM battery_rotation_batteries WHERE id = $1 AND org_id = $2`, [
    input.batteryId,
    input.orgId,
  ]);
}

export async function logReading(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    batteryId: string;
    recordedAt: string | null;
    internalResistanceMohm: number;
    voltage: number | null;
    cycleCount: number | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO battery_rotation_readings
       (org_id, battery_id, recorded_at, internal_resistance_mohm, voltage, cycle_count, notes, logged_by)
     VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.batteryId,
      input.recordedAt,
      input.internalResistanceMohm,
      input.voltage,
      input.cycleCount,
      input.notes,
      input.userId,
    ],
  );
}

export async function scheduleAssignment(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    batteryId: string;
    matchLabel: string;
    scheduledAt: string;
    chargeMinutesAvailable: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO battery_rotation_assignments
       (org_id, battery_id, match_label, scheduled_at, charge_minutes_available, notes, created_by)
     VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7)`,
    [
      input.orgId,
      input.batteryId,
      input.matchLabel,
      input.scheduledAt,
      input.chargeMinutesAvailable,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteAssignment(
  client: PoolClient,
  input: { orgId: string; assignmentId: string },
): Promise<void> {
  await client.query(`DELETE FROM battery_rotation_assignments WHERE id = $1 AND org_id = $2`, [
    input.assignmentId,
    input.orgId,
  ]);
}
