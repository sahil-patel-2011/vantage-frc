/** Waitlist-only access helpers for Vantage auth. */
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import {
  PLATFORM_OWNER_EMAIL_DEFAULT,
  configuredPlatformOwnerEmail,
  isDatabaseConfigured,
  normalizeEmail,
  resolveAuthSecret,
} from "./access-policy";
import { parseClaimIntentToken } from "./claim-intent";
import { hashInviteToken, isInviteTokenShape } from "./invite-token";

export const WAITLIST_ONLY_MESSAGE =
  "Vantage is waitlist-only right now. Join the waitlist for access, or sign in with an authorized account.";

export type AuthEmailAccessReason =
  | "platform_owner"
  | "existing_user"
  | "pending_invite"
  | "open_join_link"
  | "coach_claim"
  | "denied";

export type AuthEmailAccess = {
  allowed: boolean;
  reason: AuthEmailAccessReason;
  email: string;
};

function authConnectionString() {
  return firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL", "DATABASE_ADMIN_URL") || null;
}

/** Synchronous allowlist for the configured platform owner email. */
export function isPlatformOwnerEmail(email: string) {
  return normalizeEmail(email) === configuredPlatformOwnerEmail();
}

/**
 * Resolve whether an email may authenticate under waitlist-only policy.
 * Allowed: platform owner, existing user, pending invite, open join link,
 * or a signed coach-claim intent for an unused official team number.
 */
export async function resolveAuthEmailAccess(
  email: string,
  options?: { joinToken?: string | null; claimToken?: string | null },
): Promise<AuthEmailAccess> {
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

  const pool = createSqlPool(connectionString, { max: 1 });
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

    const joinToken = options?.joinToken?.trim() ?? "";
    if (isInviteTokenShape(joinToken)) {
      const join = await pool.query<{ id: string }>(
        `SELECT id FROM team_join_links
          WHERE token_hash = $1
            AND revoked_at IS NULL
            AND expires_at > now()
            AND use_count < max_uses
          LIMIT 1`,
        [hashInviteToken(joinToken)],
      );
      if (join.rows[0]) {
        return { allowed: true, reason: "open_join_link", email: normalized };
      }
    }

    const claimTeamNumber = parseClaimIntentToken(options?.claimToken, resolveAuthSecret());
    if (claimTeamNumber != null) {
      const claimable = await pool.query<{ claimable: boolean }>(
        `SELECT peek_claimable_frc_team($1::int) AS claimable`,
        [claimTeamNumber],
      );
      if (claimable.rows[0]?.claimable) {
        return { allowed: true, reason: "coach_claim", email: normalized };
      }
    }

    return { allowed: false, reason: "denied", email: normalized };
  } catch {
    return { allowed: false, reason: "denied", email: normalized };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export { PLATFORM_OWNER_EMAIL_DEFAULT, configuredPlatformOwnerEmail, normalizeEmail };
