import { hostname } from "node:os";
import type { PoolClient } from "@neondatabase/serverless";
import { createFreeRelayChatAdapter, type FreeRelayJobKind } from "./adapter";
import { sweepAssemblyManualRuns, type AssemblyManualSweep } from "./assembly-manual";
import { runMemoryDreamJob } from "./memory-dream";
import { sweepVideoAnalysisJobs, type VideoJobSweep } from "./video-jobs";

export type FreeRelaySweepResult = {
  scheduled: number;
  processed: number;
  completed: number;
  failed: number;
  skipped: boolean;
  reason?: string;
  /**
   * Assembly-manual runs advanced by this sweep. Absent when the relay has no
   * engine wired in — see `sweepAssemblyManualRuns`, which says so rather than
   * reporting an empty queue.
   */
  assemblyManual?: AssemblyManualSweep;
  videoAnalysis?: VideoJobSweep;
};

/**
 * Who this relay is, for the assembly-manual lease. Machine name plus pid, so
 * two relays on the same box (or one restarted mid-run) never collide on the
 * lease and quietly advance the same job twice.
 */
export function freeRelayLeaseOwner(env: NodeJS.ProcessEnv = process.env): string {
  const label = env.FREE_RELAY_WORKER_ID?.trim();
  if (label) return label.slice(0, 120);
  let machine: string;
  try {
    machine = hostname() || "relay";
  } catch {
    machine = "relay";
  }
  return `${machine}:${process.pid}`.slice(0, 120);
}

function localDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function scheduleMemoryDreamJobs(
  client: PoolClient,
  dayKey = localDayKey(),
): Promise<{ scheduled: number }> {
  const orgs = await client.query<{ orgId: string }>(
    `SELECT s.org_id AS "orgId"
     FROM team_memory_settings s
     WHERE s.enabled = true
       AND NOT EXISTS (
         SELECT 1 FROM free_relay_jobs j
         WHERE j.org_id = s.org_id
           AND j.kind = 'memory_dream'
           AND j.created_at >= ($1::date - interval '20 hours')
       )`,
    [dayKey],
  );

  let scheduled = 0;
  for (const row of orgs.rows) {
    await client.query(
      `INSERT INTO free_relay_jobs (org_id, kind, status, scheduled_for, metadata)
       VALUES ($1, 'memory_dream', 'queued', now(), $2::jsonb)`,
      [row.orgId, JSON.stringify({ dayKey })],
    );
    scheduled += 1;
  }
  return { scheduled };
}

export async function runFreeRelayJob(
  client: PoolClient,
  jobId: string,
  adapter = createFreeRelayChatAdapter("free_relay"),
): Promise<void> {
  const job = await client.query<{
    orgId: string;
    kind: FreeRelayJobKind;
    metadata: { dayKey?: string };
  }>(
    `SELECT org_id AS "orgId", kind, metadata
     FROM free_relay_jobs
     WHERE id = $1 AND status = 'running'`,
    [jobId],
  );
  const row = job.rows[0];
  if (!row) throw new Error("Job not found or not running");

  try {
    if (row.kind === "memory_dream") {
      const dayKey = row.metadata?.dayKey ?? localDayKey();
      const result = await runMemoryDreamJob(client, adapter, row.orgId, dayKey);
      await client.query(
        `UPDATE free_relay_jobs
         SET status = $2, completed_at = now(), result = $3::jsonb, updated_at = now()
         WHERE id = $1`,
        [
          jobId,
          result.skipped ? "skipped" : "completed",
          JSON.stringify(result),
        ],
      );
      return;
    }

    if (row.kind === "overnight_intel" || row.kind === "bugbot_scan") {
      await client.query(
        `UPDATE free_relay_jobs
         SET status = 'skipped', completed_at = now(),
             result = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [
          jobId,
          JSON.stringify({
            reason: "not_implemented_on_pi_yet",
            hint: "Enqueue from web compute-* paths or extend free-relay worker",
          }),
        ],
      );
      return;
    }

    throw new Error(`Unknown free relay job kind: ${row.kind}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "free_relay_failed";
    await client.query(
      `UPDATE free_relay_jobs
       SET status = 'failed', completed_at = now(), error = $2, updated_at = now()
       WHERE id = $1`,
      [jobId, message.slice(0, 2000)],
    );
    throw error;
  }
}

export async function claimFreeRelayJobs(
  client: PoolClient,
  limit = 8,
): Promise<string[]> {
  const claimed = await client.query<{ id: string }>(
    `UPDATE free_relay_jobs j
     SET status = 'running', started_at = now(), updated_at = now()
     WHERE j.id IN (
       SELECT id FROM free_relay_jobs
       WHERE status = 'queued' AND scheduled_for <= now()
       ORDER BY scheduled_for
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING j.id`,
    [limit],
  );
  return claimed.rows.map((row) => row.id);
}

export async function runFreeRelaySweep(input?: {
  scheduleDreams?: boolean;
  dayKey?: string;
  jobLimit?: number;
  /** Set false to leave assembly-manual runs to a different worker. */
  advanceAssemblyManuals?: boolean;
  assemblyManualSliceMs?: number;
}): Promise<FreeRelaySweepResult> {
  const { createSqlPool } = await import("@vantage/db/pool");
  const { firstConfiguredEnv } = await import("@vantage/db/postgres-url");
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    return { scheduled: 0, processed: 0, completed: 0, failed: 0, skipped: true, reason: "database_unset" };
  }

  // The assembly manual does not need an AI backend — without one it writes
  // deterministic step sentences and still produces the book — so it is swept
  // before the free-relay AI gate below, not after it.
  let assemblyManual: AssemblyManualSweep | undefined;
  let videoAnalysis: VideoJobSweep | undefined;
  if (input?.advanceAssemblyManuals ?? true) {
    const pool = createSqlPool(connectionString);
    const client = await pool.connect();
    try {
      assemblyManual = await sweepAssemblyManualRuns(client, {
        leaseOwner: freeRelayLeaseOwner(),
        ...(input?.assemblyManualSliceMs !== undefined ? { sliceMs: input.assemblyManualSliceMs } : {}),
      });
      videoAnalysis = await sweepVideoAnalysisJobs(client, {
        leaseOwner: freeRelayLeaseOwner(),
        adapter: null,
      });
    } finally {
      client.release();
      await pool.end().catch(() => undefined);
    }
  }

  const { isFreeRelayConfigured } = await import("./adapter");
  if (!isFreeRelayConfigured()) {
    return {
      scheduled: 0,
      processed: 0,
      completed: 0,
      failed: 0,
      skipped: true,
      reason: "free_relay_unset",
      ...(assemblyManual ? { assemblyManual } : {}),
      ...(videoAnalysis ? { videoAnalysis } : {}),
    };
  }

  const pool = createSqlPool(connectionString);
  const client = await pool.connect();
  let scheduled = 0;
  let processed = 0;
  let completed = 0;
  let failed = 0;

  try {
    await client.query("BEGIN");
    if (input?.scheduleDreams ?? true) {
      const schedule = await scheduleMemoryDreamJobs(client, input?.dayKey);
      scheduled = schedule.scheduled;
    }
    const jobIds = await claimFreeRelayJobs(client, input?.jobLimit ?? 8);
    await client.query("COMMIT");

    const adapter = createFreeRelayChatAdapter("free_relay");
    for (const jobId of jobIds) {
      processed += 1;
      try {
        await runFreeRelayJob(client, jobId, adapter);
        completed += 1;
      } catch {
        failed += 1;
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }

  return {
    scheduled,
    processed,
    completed,
    failed,
    skipped: false,
    ...(assemblyManual ? { assemblyManual } : {}),
    ...(videoAnalysis ? { videoAnalysis } : {}),
  };
}
