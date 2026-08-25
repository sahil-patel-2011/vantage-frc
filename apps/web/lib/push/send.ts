/**
 * Delivering one Web Push message to one push service (FCM, Mozilla autopush,
 * Windows WNS, Apple). We speak the standard protocol, so there is no per-browser
 * branch: encrypt with aes128gcm, sign a VAPID JWT for the endpoint origin, POST.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { encryptPushPayload } from "./encrypt";
import { pushSetupStatus, vapidAuthorizationHeader, vapidConfig } from "./vapid";

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; gone: boolean; error: string };

export type SendWebPushOptions = {
  /** Seconds the push service should retain an undeliverable message. */
  ttlSeconds?: number;
  /** `high` wakes the device promptly — used for the 7-minutes-out scout ping. */
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Push services must answer fast; the TBA webhook has a 10-second budget. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** 404/410 mean the browser threw the subscription away. Anything else may be transient. */
export function isGoneStatus(status: number): boolean {
  return status === 404 || status === 410;
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: string,
  options: SendWebPushOptions = {},
): Promise<PushSendResult> {
  const config = vapidConfig();
  if (!config) {
    const status = pushSetupStatus();
    return {
      ok: false,
      status: null,
      gone: false,
      error: status.state === "setup_required" ? status.detail : "VAPID keys are not configured",
    };
  }

  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPushPayload(payload, subscription).body;
    authorization = vapidAuthorizationHeader(config, subscription.endpoint);
  } catch (error) {
    // A malformed stored subscription can never succeed — treat it as gone so the
    // caller prunes it instead of retrying forever.
    return {
      ok: false,
      status: null,
      gone: true,
      error: error instanceof Error ? error.message : "Could not encrypt push payload",
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? 600),
        Urgency: options.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 6000),
    });
    if (response.ok) return { ok: true, status: response.status };
    return {
      ok: false,
      status: response.status,
      gone: isGoneStatus(response.status),
      error: `Push service responded ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      gone: false,
      error: error instanceof Error ? error.message : "Push request failed",
    };
  }
}

/**
 * Remove a subscription the push service says no longer exists. Idempotent, and
 * safe to call from a worker connection: `endpoint` is globally unique.
 */
export async function pruneDeadSubscription(
  client: PoolClient,
  endpoint: string,
): Promise<{ pruned: number }> {
  const result = await client.query(`DELETE FROM push_subscriptions WHERE endpoint = $1::text`, [
    endpoint,
  ]);
  return { pruned: result.rowCount ?? 0 };
}

/** Mark a subscription as failing without deleting it (transient errors). */
export async function markSubscriptionFailed(
  client: PoolClient,
  endpoint: string,
): Promise<void> {
  await client.query(
    `UPDATE push_subscriptions SET failed_at = now() WHERE endpoint = $1::text`,
    [endpoint],
  );
}

/**
 * Fan a single payload out to every device a user registered. Dead endpoints are
 * pruned inline; a transient failure is recorded but the row is kept.
 */
export async function sendToSubscriptions(
  client: PoolClient,
  subscriptions: PushSubscriptionRecord[],
  payload: string,
  options: SendWebPushOptions = {},
): Promise<{ delivered: number; pruned: number; failed: number; skipped: boolean }> {
  let delivered = 0;
  let pruned = 0;
  let failed = 0;
  // Without VAPID keys nothing can be delivered. Skip quietly rather than marking
  // every one of the team's devices as broken because the server is unconfigured.
  if (!vapidConfig() || subscriptions.length === 0) {
    return { delivered: 0, pruned: 0, failed: 0, skipped: true };
  }
  const results = await Promise.all(
    subscriptions.map(async (subscription) => ({
      subscription,
      result: await sendWebPush(subscription, payload, options),
    })),
  );
  for (const { subscription, result } of results) {
    if (result.ok) {
      delivered += 1;
      await client.query(
        `UPDATE push_subscriptions SET last_seen_at = now(), failed_at = NULL WHERE endpoint = $1::text`,
        [subscription.endpoint],
      );
      continue;
    }
    if (result.gone) {
      pruned += (await pruneDeadSubscription(client, subscription.endpoint)).pruned;
      continue;
    }
    failed += 1;
    await markSubscriptionFailed(client, subscription.endpoint);
  }
  return { delivered, pruned, failed, skipped: false };
}
