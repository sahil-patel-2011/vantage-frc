import { createHash, randomBytes } from "node:crypto";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv, resolveAppDatabaseUrl } from "@vantage/db/postgres-url";

/**
 * The one-time token that carries a signed-in person from one product host to
 * the other (migration 0670, product-handoff-plugin.ts).
 *
 * 32 random bytes, base64url in the link, sha256 hex at rest. The link lives
 * for 60 seconds and redeems once, only on the host it was minted for.
 */

export function newHandoffToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: handoffTokenHash(token) };
}

export function handoffTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A base64url string of exactly 32 bytes; anything else is not ours. */
export function isHandoffTokenShape(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export type ConsumedHandoff = {
  userId: string;
  orgId: string | null;
  targetPath: string;
  authMethod: string;
  email2faVerifiedAt: string | null;
};

let pool: ReturnType<typeof createSqlPool> | undefined;

/**
 * Redemption runs before the destination host has any session, so it cannot
 * use withRls. It runs on the auth connection (vantage_auth), which may only
 * EXECUTE consume_product_handoff — it cannot read the table.
 */
function handoffPool() {
  if (!pool) {
    const url = firstConfiguredEnv("DATABASE_AUTH_URL") || resolveAppDatabaseUrl();
    pool = createSqlPool(url, { max: 2 });
  }
  return pool;
}

export async function consumeHandoff(token: string, host: string): Promise<ConsumedHandoff | null> {
  const result = await handoffPool().query<{
    user_id: string;
    org_id: string | null;
    target_path: string;
    auth_method: string;
    email_2fa_verified_at: Date | string | null;
  }>(`SELECT * FROM consume_product_handoff($1, $2)`, [handoffTokenHash(token), host]);
  const row = result.rows[0];
  if (!row) return null;
  const verified = row.email_2fa_verified_at;
  return {
    userId: row.user_id,
    orgId: row.org_id,
    targetPath: row.target_path,
    authMethod: row.auth_method,
    email2faVerifiedAt: verified == null ? null : new Date(verified).toISOString(),
  };
}
