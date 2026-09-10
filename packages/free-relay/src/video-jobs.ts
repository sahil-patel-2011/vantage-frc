/**
 * Claim and finish video_analysis_jobs on the video-role Pi.
 * Without a vision adapter the job is skipped with an honest reason —
 * we never write a fake timeline into the product.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { analyzeClip, type VisionAdapter, type VideoSourceKind } from "./video-analysis";

export type VideoJobSweep = {
  claimed: number;
  completed: number;
  skipped: number;
  failed: number;
  reason?: string;
};

type ClaimedJob = {
  id: string;
  sourceKind: VideoSourceKind;
  sourceRef: string;
  matchKey: string | null;
};

export async function claimVideoAnalysisJobs(
  client: PoolClient,
  leaseOwner: string,
  limit = 2,
): Promise<ClaimedJob[]> {
  const claimed = await client.query<ClaimedJob>(
    `UPDATE video_analysis_jobs j
     SET status = 'running',
         lease_owner = $1,
         lease_until = now() + interval '10 minutes',
         heartbeat_at = now(),
         updated_at = now()
     WHERE j.id IN (
       SELECT id FROM video_analysis_jobs
       WHERE status = 'queued' AND cancel_requested_at IS NULL
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING j.id,
               j.source_kind AS "sourceKind",
               j.source_ref AS "sourceRef",
               j.match_key AS "matchKey"`,
    [leaseOwner.slice(0, 120), limit],
  );
  return claimed.rows;
}

export async function runVideoAnalysisJob(
  client: PoolClient,
  job: ClaimedJob,
  adapter: VisionAdapter | null,
): Promise<"completed" | "skipped" | "failed"> {
  if (!adapter) {
    await client.query(
      `UPDATE video_analysis_jobs
       SET status = 'skipped',
           error = $2,
           updated_at = now()
       WHERE id = $1`,
      [
        job.id,
        "This Pi has no vision model. Set FREE_RELAY_VISION_MODEL on the video instance, or leave the job queued until a video Pi is paired.",
      ],
    );
    return "skipped";
  }
  try {
    const record = await analyzeClip(adapter, {
      matchKey: job.matchKey,
      sourceKind: job.sourceKind,
      sourceRef: job.sourceRef,
      durationSec: 150,
    });
    await client.query(
      `UPDATE video_analysis_jobs
       SET status = 'completed',
           result = $2::jsonb,
           minutes_behind = $3,
           error = NULL,
           lease_owner = NULL,
           lease_until = NULL,
           updated_at = now()
       WHERE id = $1`,
      [job.id, JSON.stringify(record), record.minutesBehindLive],
    );
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "video_analysis_failed";
    await client.query(
      `UPDATE video_analysis_jobs
       SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1`,
      [job.id, message.slice(0, 2000)],
    );
    return "failed";
  }
}

export async function sweepVideoAnalysisJobs(
  client: PoolClient,
  input: { leaseOwner: string; adapter: VisionAdapter | null; limit?: number },
): Promise<VideoJobSweep> {
  const claimed = await claimVideoAnalysisJobs(client, input.leaseOwner, input.limit ?? 2);
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of claimed) {
    const outcome = await runVideoAnalysisJob(client, job, input.adapter);
    if (outcome === "completed") completed += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
  }
  return { claimed: claimed.length, completed, skipped, failed };
}
