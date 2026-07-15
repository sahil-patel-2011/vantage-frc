/** Waitlist-only access helpers for Vantage auth. */
import { Pool } from "@neondatabase/serverless";
import {
  PLATFORM_OWNER_EMAIL_DEFAULT,
  configuredPlatformOwnerEmail,
  isDatabaseConfigured,
  normalizeEmail,
} from "./access-policy";

export const WAITLIST_ONLY_MESSAGE =
  "Vantage is waitlist-only right now. Join the waitlist for access, or sign in with an authorized account.";

export type AuthEmailAccessReason =
  | "platform_owner"
  | "existing_user"
  | "pending_invite"
  | "denied";

export type AuthEmailAccess = {
  allowed: boolean;
  reason: AuthEmailAccessReason;
  email: string;
};

function authConnectionString() {
  return (
    process.env.DATABASE_AUTH_URL ||
    process.env.DATABASE_URL ||
    process.env.DATABASE_ADMIN_URL ||
    null
  );
}

/** Synchronous allowlist for the configured platform owner email. */
export function isPlatformOwnerEmail(email: string) {
  return normalizeEmail(email) === configuredPlatformOwnerEmail();
}

/**
 * Resolve whether an email may authenticate under waitlist-only policy.
 * Allowed: platform owner, existing user, or non-expired pending invite.
 */
export async function resolveAuthEmailAccess(email: string): Promise<AuthEmailAccess> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { allowed: false, reason: "denied", email: normalized };
  }
  if (isPlatformOwnerEmail(normalized)) {
    return { allowed: true, reason: "platform_owner", email: normalized };
  }
  if (!isDatabaseConfigured()) {
    return { allowed: false, reason: "denied", email: normalized };
  }
  const connectionString = authConnectionString();
  if (!connectionString) {
    return { allowed: false, reason: "denied", email: normalized };
  }

  const pool = new Pool({ connectionString });
  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1`,
      [normalized],
    );
    if (existing.rows[0]) {
      return { allowed: true, reason: "existing_user", email: normalized };
    }

    const invite = await pool.query<{ id: string }>(
      `SELECT id FROM invites
        WHERE lower(email)=lower($1)
          AND status='pending'
          AND expires_at > now()
        LIMIT 1`,
      [normalized],
    );
    if (invite.rows[0]) {
      return { allowed: true, reason: "pending_invite", email: normalized };
    }

    return { allowed: false, reason: "denied", email: normalized };
  } catch {
    return { allowed: false, reason: "denied", email: normalized };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export { PLATFORM_OWNER_EMAIL_DEFAULT, configuredPlatformOwnerEmail, normalizeEmail };
