import type { PoolClient } from "@neondatabase/serverless";
import { computeBatteryForecast, summarizeFleet } from ".";
import {
  batteryHealthForecastSetupSteps,
  type BatteryHealthForecastSetupStep,
} from "./battery-health-forecast-related";
import type {
  BatteryForecast,
  BatteryHealthReading,
  BatteryHealthRecord,
  BatteryLifecycleStatus,
  FleetSummary,
} from "./types";

export type { BatteryHealthForecastSetupStep };

export type BatteryHealthForecastView =
  | {
      status: "setup_required";
      message: string;
      steps: BatteryHealthForecastSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      batteries: BatteryHealthRecord[];
      forecasts: BatteryForecast[];
      summary: FleetSummary;
      computedAt: string;
    };

type BatteryRow = {
  id: string;
  label: string;
  serialNumber: string | null;
  status: BatteryLifecycleStatus;
  putInServiceOn: string | null;
  retiredOn: string | null;
  notes: string | null;
  createdAt: string;
};

type ReadingRow = {
  id: string;
  batteryId: string;
  recordedAt: string;
  cycleCount: number;
  internalResistanceMohm: string;
  voltage: string | null;
  notes: string | null;
};

function mapBattery(row: BatteryRow): BatteryHealthRecord {
  return {
    id: row.id,
    label: row.label,
    serialNumber: row.serialNumber,
    status: row.status,
    putInServiceOn: row.putInServiceOn,
    retiredOn: row.retiredOn,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function mapReading(row: ReadingRow): BatteryHealthReading {
  return {
    id: row.id,
    batteryId: row.batteryId,
    recordedAt: row.recordedAt,
    cycleCount: Number(row.cycleCount) || 0,
    internalResistanceMohm: Number(row.internalResistanceMohm) || 0,
    voltage: row.voltage != null ? Number(row.voltage) : null,
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

export async function computeBatteryHealthForecastView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<BatteryHealthForecastView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to forecast battery end-of-life.",
      steps: batteryHealthForecastSetupSteps(null),
      orgId: null,
    };
  }

  const [batteryResult, readingResult] = await Promise.all([
    client.query<BatteryRow>(
      `SELECT id, label, serial_number AS "serialNumber", status,
              put_in_service_on::text AS "putInServiceOn", retired_on::text AS "retiredOn",
              notes, created_at::text AS "createdAt"
       FROM battery_health_forecast_batteries
       WHERE org_id = $1
       ORDER BY status, label`,
      [org.orgId],
    ),
    client.query<ReadingRow>(
      `SELECT r.id, r.battery_id AS "batteryId", r.recorded_at::text AS "recordedAt",
              r.cycle_count AS "cycleCount", r.internal_resistance_mohm AS "internalResistanceMohm",
              r.voltage::text AS "voltage", r.notes
       FROM battery_health_forecast_readings r
       WHERE r.org_id = $1
       ORDER BY r.recorded_at ASC`,
      [org.orgId],
    ),
  ]);

  const batteries = batteryResult.rows.map(mapBattery);
  const readingsByBattery = new Map<string, BatteryHealthReading[]>();
  for (const row of readingResult.rows) {
    const reading = mapReading(row);
    const list = readingsByBattery.get(reading.batteryId) ?? [];
    list.push(reading);
    readingsByBattery.set(reading.batteryId, list);
  }

  const forecasts = batteries.map((battery) =>
    computeBatteryForecast(battery, readingsByBattery.get(battery.id) ?? []),
  );
  const summary = summarizeFleet(forecasts);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    batteries,
    forecasts,
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
    putInServiceOn: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO battery_health_forecast_batteries (
       org_id, label, serial_number, put_in_service_on, notes, created_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6)`,
    [input.orgId, input.label, input.serialNumber, input.putInServiceOn, input.notes, input.userId],
  );
}

export async function logReading(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    batteryId: string;
    recordedAt: string | null;
    cycleCount: number;
    internalResistanceMohm: number;
    voltage: number | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO battery_health_forecast_readings (
       org_id, battery_id, recorded_at, cycle_count, internal_resistance_mohm, voltage, notes, logged_by
     ) VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.batteryId,
      input.recordedAt,
      Math.max(0, Math.round(input.cycleCount)),
      Math.max(0, input.internalResistanceMohm),
      input.voltage,
      input.notes,
      input.userId,
    ],
  );
}

export async function retireBattery(
  client: PoolClient,
  input: { orgId: string; batteryId: string; retiredOn: string | null },
): Promise<void> {
  await client.query(
    `UPDATE battery_health_forecast_batteries
     SET status = 'retired', retired_on = COALESCE($3::date, CURRENT_DATE)
     WHERE id = $1 AND org_id = $2`,
    [input.batteryId, input.orgId, input.retiredOn],
  );
}

export async function reactivateBattery(
  client: PoolClient,
  input: { orgId: string; batteryId: string },
): Promise<void> {
  await client.query(
    `UPDATE battery_health_forecast_batteries
     SET status = 'active', retired_on = NULL
     WHERE id = $1 AND org_id = $2`,
    [input.batteryId, input.orgId],
  );
}

export async function deleteBattery(
  client: PoolClient,
  input: { orgId: string; batteryId: string },
): Promise<void> {
  await client.query(`DELETE FROM battery_health_forecast_batteries WHERE id = $1 AND org_id = $2`, [
    input.batteryId,
    input.orgId,
  ]);
}
