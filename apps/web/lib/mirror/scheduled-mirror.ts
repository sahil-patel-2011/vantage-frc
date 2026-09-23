import type { Pool } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { isMirrorNotMigrated } from "../google-sheets/connection-store";
import { readOrgRole, roleCanManageWorkbook } from "../microsoft/authz";
import { runScheduledWorkbookSync } from "../microsoft/scheduled-sync";
import { syncMirror } from "./mirror-sync";
import { connectedTargetDefs, readCopyStates } from "./mirror-targets";

/**
 * Nightly spreadsheet mirror: every team with a Google or Excel copy gets both written from
 * Postgres, at most a day stale. Rides the daily season cron right after the TBA ingest,
 * so the copies carry that morning's matches and rankings from Vantage's own TBA cache —
 * the mirror never calls TBA itself.
 *
 * Same rules as the Excel-only job it replaces: the worker pool only LISTS due teams; each
 * sync runs under withRls as the person who connected, and only while they are still an
 * owner or admin. Bounded and one team at a time, because both providers throttle per app.
 * Until migration 0682 is applied it falls back to the Excel-only job.
 */
export type ScheduledMirrorSummary = {
  mode: "mirror" | "excel_only";
  scanned: number;
  synced: number;
  failed: number;
  notAllowed: number;
  fallback?: unknown;
};

export type ScheduledMirrorDeps = {
  listDue: (limit: number) => Promise<Array<{ orgId: string; userId: string }>>;
  syncOne: (orgId: string, userId: string) => Promise<"synced" | "failed" | "not_allowed">;
};

export async function runScheduledMirrorSync(
  options: { limit?: number; deps?: ScheduledMirrorDeps } = {},
): Promise<ScheduledMirrorSummary> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 25));
  const summary: ScheduledMirrorSummary = { mode: "mirror", scanned: 0, synced: 0, failed: 0, notAllowed: 0 };
  const deps = options.deps ?? productionDeps();

  let due: Array<{ orgId: string; userId: string }>;
  try {
    due = await deps.listDue(limit);
  } catch (error) {
    if (!isMirrorNotMigrated(error)) throw error;
    return { ...summary, mode: "excel_only", fallback: await runScheduledWorkbookSync({ limit }) };
  }
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
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the scheduled mirror sync");
  return createSqlPool(connectionString);
}

function productionDeps(): ScheduledMirrorDeps {
  return {
    async listDue(limit) {
      const pool = workerPool();
      try {
        // A team is due when either copy is more than 20 hours old. The person who
        // connected Excel runs it when there is one; otherwise whoever connected Google.
        const result = await pool.query<{ orgId: string; userId: string }>(
          `WITH copies AS (
             SELECT org_id, connected_by, last_sync_at, last_error, 1 AS pref FROM org_microsoft_connections
             UNION ALL
             SELECT org_id, connected_by, last_sync_at, last_error, 2 AS pref FROM org_google_sheets_connections
           ),
           usable AS (
             SELECT * FROM copies
              WHERE connected_by IS NOT NULL
                AND (last_error IS NULL OR NOT (
                  last_error LIKE '%sign-in expired%'
                  OR last_error LIKE '%refused access%'
                  OR last_error LIKE 'Vantage could not decrypt%'))
           )
           SELECT DISTINCT ON (org_id) org_id AS "orgId", connected_by AS "userId"
             FROM usable
            WHERE org_id IN (
              SELECT org_id FROM usable
               GROUP BY org_id
              HAVING bool_or(last_sync_at IS NULL OR last_sync_at < now() - interval '20 hours'))
            ORDER BY org_id, pref, last_sync_at NULLS FIRST
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
        const states = await readCopyStates(client, orgId);
        const targets = connectedTargetDefs(client, orgId, states.copies);
        if (!targets.length) return "failed" as const;
        const result = await syncMirror(client, orgId, { targets, userId });
        if (result.status !== "done") return "failed" as const;
        return result.copies.some((copy) => copy.status === "succeeded" || copy.status === "partial")
          ? ("synced" as const)
          : ("failed" as const);
      });
    },
  };
}
