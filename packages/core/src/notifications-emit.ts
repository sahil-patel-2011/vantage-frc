import type { PoolClient } from "@neondatabase/serverless";

/** Canonical insert into `notifications`. Callers that notify another member need a peer-insert RLS policy. */
export async function emitNotification(
  client: PoolClient,
  input: { userId: string; orgId?: string; type: string; payload?: Record<string, unknown> },
): Promise<void> {
  await client.query(`INSERT INTO notifications (user_id, org_id, type, payload) VALUES ($1, $2, $3, $4::jsonb)`, [
    input.userId,
    input.orgId ?? null,
    input.type,
    JSON.stringify(input.payload ?? {}),
  ]);
}
