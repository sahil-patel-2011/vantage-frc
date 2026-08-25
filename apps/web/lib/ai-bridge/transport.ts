import type { BridgeJobStatus, SubscriptionBridgeTransport } from "@vantage/agent";
import { getAiBridgePool } from "./pool";

/**
 * DB-backed transport for SubscriptionBridgeChatAdapter. Runs on the pairing pool
 * (committed per-statement) so the paired device's claim function sees jobs
 * immediately — see pool.ts for why this must not use the request's RLS transaction.
 *
 * Pass as `bridgeTransport` to every resolveOrgChatAdapter* call made on behalf of an
 * org. The resolver gates what actually rides the bridge: chat-class features on any
 * preferred device, everything else only when the paired device opted into
 * coverage='everything'. Injecting it from a route or worker that never qualifies is
 * harmless — the adapter is only constructed when a covering device is online.
 */
export function createBridgeTransport(): SubscriptionBridgeTransport {
  return {
    async enqueue(input) {
      const result = await getAiBridgePool().query<{ id: string }>(
        // timeoutMs rides inside messages: the device clamps and honors it, and the
        // claim function (0488) grows the job lease from it for long jobs.
        `INSERT INTO ai_bridge_jobs (org_id, requested_by, feature, messages, requested_engine)
         VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5)
         RETURNING id`,
        [
          input.orgId,
          input.userId,
          input.feature,
          JSON.stringify({ prompt: input.prompt, timeoutMs: input.timeoutMs }),
          input.requestedEngine,
        ],
      );
      return { jobId: result.rows[0]!.id };
    },

    async poll(jobId): Promise<BridgeJobStatus> {
      const result = await getAiBridgePool().query<{
        state: BridgeJobStatus["state"];
        result: BridgeJobStatus["result"];
        errorClass: string | null;
        errorMessage: string | null;
      }>(
        `SELECT state, result, error_class AS "errorClass", error_message AS "errorMessage"
           FROM ai_bridge_jobs
          WHERE id = $1::uuid`,
        [jobId],
      );
      const row = result.rows[0];
      if (!row) return { state: "expired", errorClass: "queue_expired", errorMessage: "Job not found." };
      return row;
    },

    async abandon(jobId) {
      // Only a still-queued job is cancelled; a leased one finishes on the device and
      // its (discarded) result costs nothing extra to record.
      await getAiBridgePool().query(
        `UPDATE ai_bridge_jobs
            SET state = 'expired', completed_at = now(),
                error_class = 'queue_expired',
                error_message = 'The web caller stopped waiting for this job.'
          WHERE id = $1::uuid AND state = 'queued'`,
        [jobId],
      );
    },
  };
}
