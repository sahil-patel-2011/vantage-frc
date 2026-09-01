import type { PoolClient } from "@neondatabase/serverless";

/**
 * Time-boxed platform AI access granted to one org (migration 0515).
 *
 * This lives in @vantage/agent rather than @vantage/billing on purpose: the chat
 * resolver needs it, and billing already avoids importing agent (see the note on
 * isPlatformHostedFreeConfigured in packages/billing/src/platform-free.ts). Keeping the
 * query here preserves that one-way dependency.
 *
 * A missing row is never an error — it just means the team is not on a platform-funded
 * path right now and falls back to its own keys.
 */

export type OrgAiAccessKind = "platform_relay" | "sponsored_pool" | "hosted_platform";

/**
 * Whether this org currently holds an active, non-revoked grant of this kind.
 *
 * Returns false rather than throwing when the table is absent, so a deployment that has
 * not applied 0515 yet degrades to "no grant" instead of breaking every chat request.
 */
export async function orgHasAiAccessGrant(
  client: PoolClient,
  orgId: string,
  kind: OrgAiAccessKind,
): Promise<boolean> {
  try {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM org_ai_access_grants
          WHERE org_id = $1::uuid
            AND access_kind = $2
            AND revoked_at IS NULL
            AND starts_at <= now()
            AND ends_at > now()
       ) AS exists`,
      [orgId, kind],
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    if (error instanceof Error && /org_ai_access_grants/.test(error.message)) return false;
    throw error;
  }
}

/** End of the longest active window of this kind, for honest "expires on" copy. */
export async function orgAiAccessGrantEndsAt(
  client: PoolClient,
  orgId: string,
  kind: OrgAiAccessKind,
): Promise<Date | null> {
  try {
    const result = await client.query<{ endsAt: Date }>(
      `SELECT max(ends_at) AS "endsAt"
         FROM org_ai_access_grants
        WHERE org_id = $1::uuid
          AND access_kind = $2
          AND revoked_at IS NULL
          AND ends_at > now()`,
      [orgId, kind],
    );
    return result.rows[0]?.endsAt ?? null;
  } catch (error) {
    if (error instanceof Error && /org_ai_access_grants/.test(error.message)) return null;
    throw error;
  }
}
