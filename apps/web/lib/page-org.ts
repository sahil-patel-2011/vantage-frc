import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** Signed-in user, or the sign-in page. Product routes are already gated; this is the page's own session. */
export async function requirePageUser(nextPath: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/signin?next=${encodeURIComponent(nextPath)}`);
  return session.user;
}

/** The team in the address, or the caller's first team when the address has none. */
export async function resolvePageOrg(userId: string, requested: string | null | undefined): Promise<string | null> {
  const orgId = requested?.trim() || null;
  if (orgId) return orgId;
  return withRls({ userId }, async (client) => {
    const found = await client.query<{ orgId: string }>(
      `SELECT org_id AS "orgId" FROM memberships
        WHERE user_id = $1::uuid
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
        LIMIT 1`,
      [userId],
    );
    return found.rows[0]?.orgId ?? null;
  });
}

/**
 * One signed-in read for a page paint. The team in the address, or the caller's
 * first team, is resolved inside the same transaction as the paint so the page
 * does not open a second request just to learn which team to load.
 */
export async function withPagePaint<T>(
  nextPath: string,
  requestedOrg: string | null | undefined,
  load: (input: {
    client: PoolClient;
    userId: string;
    email: string | null;
    name: string | null;
    orgId: string | null;
  }) => Promise<T>,
): Promise<T | null> {
  const user = await requirePageUser(nextPath);
  try {
    return await withRls({ userId: user.id, orgId: requestedOrg?.trim() || undefined }, async (client) => {
      let orgId = requestedOrg?.trim() || null;
      if (!orgId) {
        const found = await client.query<{ orgId: string }>(
          `SELECT org_id AS "orgId" FROM memberships
            WHERE user_id = $1::uuid
            ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
            LIMIT 1`,
          [user.id],
        );
        orgId = found.rows[0]?.orgId ?? null;
        if (orgId) void client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      }
      return load({
        client,
        userId: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        orgId,
      });
    });
  } catch {
    return null;
  }
}
