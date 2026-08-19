import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { createSearchProvider, isLiveResearchSearchConfigured } from "./providers";
import { runResearchJob, scheduleActiveEventSweep } from "./worker";

function workerPool() {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");
  return createSqlPool(connectionString);
}

export async function runScheduledResearchSweep() {
  if (!isLiveResearchSearchConfigured()) {
    return { skipped: true as const, reason: "search_provider_unset" as const, processed: 0 };
  }

  const sqlPool = workerPool();
  const client = await sqlPool.connect();
  try {
    await client.query("BEGIN");
    const scheduled = await scheduleActiveEventSweep(client);
    const jobs = await client.query<{ id: string }>(
      `SELECT id FROM research_jobs WHERE status='queued' AND org_id IS NULL
       AND scheduled_for <= now() ORDER BY scheduled_for LIMIT 60 FOR UPDATE SKIP LOCKED`,
    );
    const provider = createSearchProvider();
    for (const job of jobs.rows) await runResearchJob(client, job.id, provider);
    await client.query("COMMIT");
    return { ...scheduled, processed: jobs.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await sqlPool.end().catch(() => undefined);
  }
}
