import type { PoolClient } from "@neondatabase/serverless";

/**
 * The ids of every team the person is on, the team they run first (owner, then admin, then the
 * oldest membership): the order proxy.ts falls back in when a page arrives without a team.
 * Read through RLS as that person, so it can only ever list their own memberships.
 */
export async function memberTeamIds(client: Pick<PoolClient, "query">, userId: string): Promise<string[]> {
  const result = await client.query<{ orgId: string }>(
    `SELECT org_id::text AS "orgId" FROM memberships WHERE user_id = $1::uuid
      ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC
      LIMIT 200`,
    [userId],
  );
  return result.rows.map((row) => row.orgId);
}
