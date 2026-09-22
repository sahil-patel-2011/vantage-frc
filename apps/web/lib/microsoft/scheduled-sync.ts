import type { Pool } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { readOrgRole, roleCanManageWorkbook } from "./authz";
import { getMicrosoftConfig } from "./graph";
import { runWorkbookSync } from "./run-sync";

/**
 * Nightly Excel sync. Rides the daily season cron (see season-cron-piggybacks.ts), so a
 * connected team's workbook is at most a day old even if nobody presses "Sync now".
 *
 * The worker pool only *lists* which teams are connected. Each sync then runs exactly like
 * "Sync now" does: under withRls as the person who connected Microsoft, and only while that
 * person is still an owner or admin of the team. Someone who was demoted or left does not
 * keep syncing the team's data through a stale connection.
 *
 * Bounded: at most `limit` teams per run, least recently synced first, one at a time
 * (Microsoft throttles per app). A team whose last attempt failed on sign-in is skipped —
 * retrying a revoked token every night only adds noise to its sync history.
 */
export type ScheduledWorkbookSyncSummary = {
  skipped?: "microsoft_not_configured";
  scanned: number;
  synced: number;
  failed: number;
  notAllowed: number;
};

export type ScheduledSyncDeps = {
  listDue: (limit: number) => Promise<Array<{ orgId: string; userId: string }>>;
  syncOne: (orgId: string, userId: string) => Promise<"synced" | "failed" | "not_allowed">;
};

export async function runScheduledWorkbookSync(
  options: { limit?: number; deps?: ScheduledSyncDeps } = {},
): Promise<ScheduledWorkbookSyncSummary> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 25));
  const summary: ScheduledWorkbookSyncSummary = { scanned: 0, synced: 0, failed: 0, notAllowed: 0 };
  let deps = options.deps;
  if (!deps) {
    const config = getMicrosoftConfig();
    if (!config) return { ...summary, skipped: "microsoft_not_configured" };
    deps = productionDeps(config);
  }

  const due = await deps.listDue(limit);
  summary.scanned = due.length;
  for (const row of due) {
    const outcome = await deps.syncOne(row.orgId, row.userId).catch(() => "failed" as const);
    if (outcome === "synced") summary.synced += 1;
    else if (outcome === "not_allowed") summary.notAllowed += 1;
    else summary.failed += 1;
  }
  return summary;
}

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the scheduled Excel sync");
  return createSqlPool(connectionString);
}

function productionDeps(config: NonNullable<ReturnType<typeof getMicrosoftConfig>>): ScheduledSyncDeps {
  return {
    async listDue(limit) {
      const pool = workerPool();
      try {
        const result = await pool.query<{ orgId: string; userId: string }>(
          `SELECT org_id AS "orgId", connected_by AS "userId"
             FROM org_microsoft_connections
            WHERE connected_by IS NOT NULL
              AND (last_sync_at IS NULL OR last_sync_at < now() - interval '20 hours')
              -- Only failures that need a person (revoked sign-in, lost access, changed
              -- keys) are skipped; a transient Microsoft outage is retried tomorrow.
              AND (last_error IS NULL OR NOT (
                last_error LIKE 'Microsoft sign-in expired%'
                OR last_error LIKE 'Microsoft refused access%'
                OR last_error LIKE 'Vantage could not decrypt%'))
            ORDER BY last_sync_at NULLS FIRST
            LIMIT $1::int`,
          [limit],
        );
        return result.rows;
      } finally {
        await pool.end().catch(() => undefined);
      }
    },
    async syncOne(orgId, userId) {
      return withRls({ userId, orgId }, async (client) => {
        if (!roleCanManageWorkbook(await readOrgRole(client, orgId, userId))) return "not_allowed" as const;
        const result = await runWorkbookSync(client, { orgId, userId, config });
        return result.status === "succeeded" || result.status === "partial" ? ("synced" as const) : ("failed" as const);
      });
    },
  };
}
