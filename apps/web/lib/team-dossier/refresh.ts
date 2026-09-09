import type { Pool } from "@neondatabase/serverless";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { DOSSIER_STALE_DAYS } from "./store";

/**
 * Weekly refresh of team dossiers. Worker-only (vantage_worker pool): runs from
 * the season-sync cron piggyback, never from a request.
 *
 * Bounded on purpose: at most `limit` teams per run, oldest first, and one
 * team at a time — each is a handful of TBA calls through the coordinated
 * client, and TBA is a shared, rate-limited cache for the whole platform.
 * Rows that were never built (a lead never opened the page) are left alone;
 * a build the team did not ask for is not this job's call.
 */
export type DossierRefreshSummary = {
  scanned: number;
  refreshed: number;
  failed: number;
  errors: string[];
};

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the team dossier refresh");
  }
  return createSqlPool(connectionString);
}

export async function runTeamDossierRefresh(options: { limit?: number } = {}): Promise<DossierRefreshSummary> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const summary: DossierRefreshSummary = { scanned: 0, refreshed: 0, failed: 0, errors: [] };
  const pool = workerPool();

  try {
    const stale = await pool.query<{ orgId: string; teamNumber: number }>(
      `SELECT org_id AS "orgId", team_number AS "teamNumber"
         FROM team_dossiers
        WHERE status IN ('ready', 'failed')
          AND (computed_at IS NULL OR computed_at < now() - ($1::int * interval '1 day'))
        ORDER BY computed_at NULLS FIRST
        LIMIT $2::int`,
      [DOSSIER_STALE_DAYS, limit],
    );
    summary.scanned = stale.rowCount ?? 0;
    if (summary.scanned === 0) return summary;

    const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");

    for (const row of stale.rows) {
      try {
        const jobs = createProductionReferenceJobs({ preferOrgIds: [row.orgId] });
        const payload = await jobs.teamDossier.run(Number(row.teamNumber));
        const ok = payload.sources.tba.ok || payload.sources.statbotics.ok;
        await pool.query(
          `UPDATE team_dossiers
              SET status = $2, profile = $3::jsonb, years_participated = $4::int[], awards = $5::jsonb,
                  events = $6::jsonb, stats = $7::jsonb, sources = $8::jsonb, error = $9,
                  computed_at = now(), updated_at = now()
            WHERE org_id = $1::uuid`,
          [
            row.orgId,
            ok ? "ready" : "failed",
            JSON.stringify(payload.profile),
            payload.yearsParticipated,
            JSON.stringify(payload.awards),
            JSON.stringify(payload.events),
            JSON.stringify(payload.stats),
            JSON.stringify(payload.sources),
            ok ? null : [payload.sources.tba.error, payload.sources.statbotics.error].filter(Boolean).join(" · "),
          ],
        );
        if (ok) summary.refreshed += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push(`${row.teamNumber}: ${error instanceof Error ? error.message : "refresh failed"}`);
      }
    }
    return summary;
  } finally {
    await pool.end();
  }
}
