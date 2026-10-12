import type { PoolClient } from "@neondatabase/serverless";
import { resolveOutboundEmailProvider } from "@vantage/core";
import { withSavepoint } from "@vantage/db";
import { loadDataSourceHealth } from "../reference-health";
import { readIncident } from "../outage/incident";
import { outageOwnerEmail } from "../outage/runtime";
import { getOutageStore } from "../outage/status-store";
import { loadKeyPool } from "./ai-credits";
import type { IntegrationCheck } from "./integration-health";
import { loadIntegrationHealth } from "./load-integration-health";
import { buildModuleHealth, type JobHealthRow, type ModuleHealthInputs, type OutageSignal } from "./module-health";

/**
 * Gathers module-health signals on the platform admin's request transaction: the
 * integration-health checks (env presence and persisted live signals), the TBA/Statbotics ingest
 * rows, the job tables through platform_job_health() (0727), the AI key pool, and the outage
 * incident from the outage store (which lives outside the database it reports on). No external
 * provider is called; "Check again" simply gathers them again.
 */

async function outageSignal(): Promise<OutageSignal> {
  const store = getOutageStore();
  const incident = await readIncident(store).catch(() => null);
  return {
    storeKind: store.kind,
    ownerEmailConfigured: Boolean(outageOwnerEmail()),
    incident: incident
      ? {
          firstSeen: incident.firstSeen,
          lastSeen: incident.lastSeen,
          closedAt: incident.closedAt,
          failures: incident.failures,
          title: incident.classification.title,
          why: incident.classification.why,
          fix: incident.classification.fix,
          causes: incident.causes.map(String),
        }
      : null,
  };
}

async function jobHealth(client: PoolClient): Promise<JobHealthRow[] | null> {
  return withSavepoint(
    client,
    async () =>
      (
        await client.query<{
          source: string;
          lastSuccessAt: string | null;
          lastFailureAt: string | null;
          runs24h: number;
          failures24h: number;
          openJobs: number;
          recentErrors: JobHealthRow["recentErrors"];
        }>(
          `SELECT source, last_success_at::text AS "lastSuccessAt", last_failure_at::text AS "lastFailureAt",
                  runs_24h AS "runs24h", failures_24h AS "failures24h", open_jobs AS "openJobs",
                  recent_errors AS "recentErrors"
             FROM platform_job_health()`,
        )
      ).rows.map((row) => ({ ...row, recentErrors: Array.isArray(row.recentErrors) ? row.recentErrors : [] })),
    null,
  );
}

export async function gatherModuleHealthInputs(
  client: PoolClient,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<ModuleHealthInputs> {
  // Sequential on purpose: one transaction, and each piece guards itself with a savepoint.
  const report = await loadIntegrationHealth(client, env, now);
  const reference = await loadDataSourceHealth(client, null).catch(() => null);
  const jobs = await jobHealth(client);
  const pool = await loadKeyPool(client, env).catch(() => ({ ready: false, keys: [], unlisted: [] }));
  const outage = await outageSignal();
  const emailDelivers = (() => {
    try {
      return Boolean(resolveOutboundEmailProvider());
    } catch {
      return false;
    }
  })();
  return {
    now,
    checks: report.checks as IntegrationCheck[],
    emailDelivers,
    outage,
    reference: (reference?.sources ?? []).map((source) => ({
      source: source.source,
      status: source.status,
      consecutiveFailures: source.consecutiveFailures,
      lastSuccessAt: source.lastSuccessAt,
      lastFailureAt: source.lastFailureAt,
      lastError: source.lastError,
    })),
    jobs,
    pool: pool.keys.map((key) => ({
      label: key.label,
      provider: key.provider,
      enabled: key.enabled,
      configured: key.configured,
      lastUsedAt: key.lastUsedAt,
      degradedAt: key.degradedAt,
      degradedReason: key.degradedReason,
    })),
  };
}

export async function loadModuleHealth(client: PoolClient, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()) {
  return buildModuleHealth(await gatherModuleHealthInputs(client, env, now));
}
