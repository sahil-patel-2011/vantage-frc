import { createHash, randomInt } from "node:crypto";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { authDb } from "@vantage/db/auth";
import { sessions, verifications } from "@vantage/db/schema";
import { and, eq, gt, lt } from "drizzle-orm";
import { isEmailDeliveryConfigured, runtimeEnv } from "./access-policy";
import {
  auditAuthEvent,
  createEmailProvider,
  deterministicLocalOtp,
} from "./email";

const POLICY = {
  expiresInSeconds: 300,
  allowedAttempts: 5,
  requestWindowSeconds: 60,
  requestLimit: 5,
} as const;

export function isEmail2faBypassEnabled() {
  return runtimeEnv("ENABLE_EMAIL_2FA_BYPASS") === "true";
}

/** Enforce email OTP second factor only when Resend can actually deliver. */
export function isEmail2faEnforced() {
  if (isEmail2faBypassEnabled()) return false;
  return isEmailDeliveryConfigured();
}

export function sessionHasEmail2fa(session: { email2faVerifiedAt?: Date | string | null } | null | undefined) {
  return Boolean(session?.email2faVerifiedAt);
}

function otpIdentifier(sessionId: string) {
  return `email-2fa:${sessionId}`;
}

function hashOtp(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function generateOtp(email: string) {
  if (process.env.NODE_ENV !== "production") {
    return deterministicLocalOtp(email, "email-2fa");
  }
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function countRecentSends(userId: string) {
  const connectionString = firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL");
  if (!connectionString) return 0;
  const pool = createSqlPool(connectionString, { max: 1 });
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM auth_audit_events
       WHERE action = 'email_2fa.sent' AND user_id = $1
         AND created_at > now() - ($2 || ' seconds')::interval`,
      [userId, String(POLICY.requestWindowSeconds)],
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await pool.end();
  }
}

export async function requestEmail2faCode(input: {
  sessionId: string;
  userId: string;
  email: string;
}) {
  if (!isEmail2faEnforced()) {
    return { sent: false as const, reason: "Email 2FA is not enforced (Resend not configured or bypass enabled)." };
  }

  if ((await countRecentSends(input.userId)) >= POLICY.requestLimit) {
    throw new Error("Too many verification emails. Wait a minute and try again.");
  }

  const provider = createEmailProvider();
  const code = generateOtp(input.email);
  const expiresAt = new Date(Date.now() + POLICY.expiresInSeconds * 1000);
  const identifier = otpIdentifier(input.sessionId);

  await authDb.delete(verifications).where(eq(verifications.identifier, identifier));
  await authDb.insert(verifications).values({
    identifier,
    value: JSON.stringify({ hash: hashOtp(code), attempts: 0 }),
    expiresAt,
  });

  await provider.sendOtp({
    email: input.email,
    otp: code,
    type: "sign-in",
  });

  await auditAuthEvent({
    action: "email_2fa.sent",
    email: input.email,
    userId: input.userId,
    success: true,
    metadata: { sessionId: input.sessionId },
  });

  return { sent: true as const, expiresInSeconds: POLICY.expiresInSeconds };
}

export async function verifyEmail2faCode(input: {
  sessionId: string;
  userId: string;
  email: string;
  code: string;
}) {
  if (isEmail2faBypassEnabled() || !isEmail2faEnforced()) {
    await markEmail2faVerified(input.sessionId);
    return { verified: true, bypassed: true };
  }

  const identifier = otpIdentifier(input.sessionId);
  const rows = await authDb
    .select()
    .from(verifications)
    .where(and(eq(verifications.identifier, identifier), gt(verifications.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error("That code is invalid or expired. Request a new one.");

  let payload: { hash: string; attempts: number };
  try {
    payload = JSON.parse(row.value) as { hash: string; attempts: number };
  } catch {
    throw new Error("That code is invalid or expired. Request a new one.");
  }

  if ((payload.attempts ?? 0) >= POLICY.allowedAttempts) {
    await authDb.delete(verifications).where(eq(verifications.id, row.id));
    throw new Error("Too many attempts. Request a new verification code.");
  }

  if (payload.hash !== hashOtp(input.code)) {
    await authDb
      .update(verifications)
      .set({ value: JSON.stringify({ hash: payload.hash, attempts: (payload.attempts ?? 0) + 1 }) })
      .where(eq(verifications.id, row.id));
    await auditAuthEvent({
      action: "email_2fa.failed",
      email: input.email,
      userId: input.userId,
      success: false,
    });
    throw new Error("That code is incorrect.");
  }

  await authDb.delete(verifications).where(eq(verifications.id, row.id));
  await markEmail2faVerified(input.sessionId);
  await authDb.delete(verifications).where(lt(verifications.expiresAt, new Date()));
  await auditAuthEvent({
    action: "email_2fa.verified",
    email: input.email,
    userId: input.userId,
    success: true,
  });
  return { verified: true, bypassed: false };
}

export async function markEmail2faVerified(sessionId: string) {
  await authDb
    .update(sessions)
    .set({ email2faVerifiedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}
