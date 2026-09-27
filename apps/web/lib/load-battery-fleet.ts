import type { PoolClient } from "@neondatabase/serverless";
import { monthsBetween } from "./battery";
import { summarizeFleet, type FleetReliability } from "./battery-reliability";

type PackRow = {
  id: string;
  label: string;
  status: string;
  purchaseDate: string | null;
  measuredAt: string | null;
  voltage: number | null;
  resistanceMilliohms: number | null;
  cycleCount: number;
  lastChargedAt: string | null;
  lastUsedAt: string | null;
  lastTestedAt: string | null;
};

/**
 * Loads the canonical battery_packs fleet with latest voltage/IR and cycle counts
 * from battery_logs. Shared by Pit, Event Day, risks, and dashboard readiness.
 */
export async function loadBatteryFleet(
  client: PoolClient,
  orgId: string,
  now: Date = new Date(),
): Promise<FleetReliability> {
  const result = await client.query<PackRow>(
    `SELECT p.id, p.label, p.status, p.purchase_date::text AS "purchaseDate",
            latest.measured_at::text AS "measuredAt",
            latest.voltage,
            latest.resistance_mohm AS "resistanceMilliohms",
            COALESCE(cycles.cycle_count, 0)::int AS "cycleCount",
            cycles.last_charged_at::text AS "lastChargedAt",
            cycles.last_used_at::text AS "lastUsedAt",
            cycles.last_tested_at::text AS "lastTestedAt"
     FROM battery_packs p
     LEFT JOIN LATERAL (
       SELECT l.created_at AS measured_at,
              l.resting_voltage AS voltage,
              l.internal_resistance_mohm AS resistance_mohm
       FROM battery_logs l
       WHERE l.battery_id = p.id AND l.org_id = p.org_id
         AND (l.resting_voltage IS NOT NULL OR l.internal_resistance_mohm IS NOT NULL)
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 1
     ) latest ON true
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE kind IN ('match', 'practice'))::int AS cycle_count,
              max(created_at) FILTER (WHERE kind IN ('charge', 'storage_charge')) AS last_charged_at,
              max(created_at) FILTER (WHERE kind IN ('match', 'practice')) AS last_used_at,
              max(created_at) FILTER (WHERE kind NOT IN ('charge', 'storage_charge') AND resting_voltage IS NOT NULL AND internal_resistance_mohm IS NOT NULL) AS last_tested_at
       FROM battery_logs l
       WHERE l.battery_id = p.id AND l.org_id = p.org_id
     ) cycles ON true
     WHERE p.org_id = $1
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'quarantine' THEN 1 ELSE 2 END, p.label
     LIMIT 100`,
    [orgId],
  );

  return summarizeFleet(
    result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      measuredAt: row.measuredAt,
      voltage: row.voltage == null ? null : Number(row.voltage),
      resistanceMilliohms: row.resistanceMilliohms == null ? null : Number(row.resistanceMilliohms),
      cycleCount: row.cycleCount,
      ageMonths: monthsBetween(row.purchaseDate, now),
      now: now.getTime(),
      lastChargedAt: row.lastChargedAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      lastTestedAt: row.lastTestedAt ?? null,
    })),
  );
}
