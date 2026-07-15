import { Pool } from "@neondatabase/serverless";
import { createSearchProvider } from "./providers";
import { runResearchJob, scheduleActiveEventSweep } from "./worker";

function pool() {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");
  return new Pool({ connectionString });
}

export async function runScheduledResearchSweep() {
  const client = await pool().connect();
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
  }
}
