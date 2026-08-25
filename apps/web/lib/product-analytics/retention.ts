/**
 * The 180-day purge for raw product events.
 *
 * The privacy policy says raw events are deleted after 180 days. This file is
 * the thing that makes that sentence true, so it is deliberately boring:
 *
 *   POST /api/analytics/retention     (Authorization: Bearer $CRON_SECRET)
 *
 * Point a daily scheduler at that route. It runs under the worker role, because
 * a purge crosses every team and no request-role session should be able to do
 * that. Nothing else in the product deletes these rows on a schedule — if this
 * stops running, rows accumulate and the policy sentence stops being true, so
 * treat a failing purge as a privacy incident, not a cleanup chore.
 *
 * Owners and admins can also clear their own team's rows early: the DELETE
 * policy in 0480_product_analytics.sql allows it under normal RLS.
 */

import type { Pool } from "@neondatabase/serverless";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";

/** Stated in the privacy policy. Changing it means changing the policy too. */
export const RAW_EVENT_RETENTION_DAYS = 180;

export type RetentionRunSummary = {
  retentionDays: number;
  /** Rows strictly older than this instant were removed. */
  cutoff: string;
  deleted: number;
};

/**
 * A window that is not a positive finite number of days falls back to the
 * documented default. A zero or negative window would place the cutoff at or
 * after "now" and delete live data, which is not a configuration we accept.
 */
export function effectiveRetentionDays(retentionDays = RAW_EVENT_RETENTION_DAYS): number {
  return Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : RAW_EVENT_RETENTION_DAYS;
}

/** Compute the cutoff without touching a database — pinned by a unit test. */
export function retentionCutoff(now: Date, retentionDays = RAW_EVENT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - effectiveRetentionDays(retentionDays) * 24 * 60 * 60 * 1000);
}

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the product-analytics retention purge");
  }
  return createSqlPool(connectionString);
}

/**
 * Delete every product event older than the retention window, across all teams.
 * Returns the real deleted count — never an estimate.
 */
export async function purgeExpiredProductEvents(
  retentionDays = RAW_EVENT_RETENTION_DAYS,
  now = new Date(),
): Promise<RetentionRunSummary> {
  const days = effectiveRetentionDays(retentionDays);
  const cutoff = retentionCutoff(now, days);
  const pool = workerPool();
  try {
    const result = await pool.query("DELETE FROM product_events WHERE created_at < $1::timestamptz", [
      cutoff.toISOString(),
    ]);
    return {
      retentionDays: days,
      cutoff: cutoff.toISOString(),
      deleted: result.rowCount ?? 0,
    };
  } finally {
    await pool.end();
  }
}
