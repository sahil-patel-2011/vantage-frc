import { createHash, randomInt } from "node:crypto";
import { authDb } from "@vantage/db/auth";
import { sessions, verifications } from "@vantage/db/schema";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { isEmailDeliveryConfigured, runtimeEnv } from "./access-policy";
import {
  auditAuthEvent,
  createEmailProvider,
  deterministicLocalOtp,
} from "./email";

export const EMAIL_2FA_POLICY = {
  expiresInSeconds: 30 * 60,
  allowedAttempts: 5,
  /** One new code a minute per sign-in. */
  resendCooldownSeconds: 60,
} as const;
const POLICY = EMAIL_2FA_POLICY;

/** The code was saved but the email could not be handed to the mail provider. */
export class Email2faDeliveryError extends Error {
  constructor(readonly causeName: string) {
    super("We couldn't send the code email. Wait a minute and try again.");
    this.name = "Email2faDeliveryError";
  }
}

export function isEmail2faBypassEnabled() {
  return runtimeEnv("ENABLE_EMAIL_2FA_BYPASS") === "true";
}

/** Enforce email OTP second factor only when Resend or Gmail SMTP can deliver. */
export function isEmail2faEnforced() {
  if (isEmail2faBypassEnabled()) return false;
  return isEmailDeliveryConfigured();
}

export function sessionHasEmail2fa(session: { email2faVerifiedAt?: Date | string | null } | null | undefined) {
  return Boolean(session?.email2faVerifiedAt);
}

/** Seconds left before another code may be sent, given when the last one was. */
export function resendWaitSeconds(lastSentAt: Date | string | null, now: number) {
  if (!lastSentAt) return 0;
  const sent = new Date(lastSentAt).getTime();
  if (!Number.isFinite(sent)) return 0;
  const left = Math.ceil((sent + POLICY.resendCooldownSeconds * 1000 - now) / 1000);
  return Math.min(Math.max(left, 0), POLICY.resendCooldownSeconds);
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

export async function requestEmail2faCode(input: {
  sessionId: string;
  userId: string;
  email: string;
}) {
  if (!isEmail2faEnforced()) {
    return { sent: false as const, reason: "Email 2FA is not enforced (Resend not configured or bypass enabled)." };
  }

  const identifier = otpIdentifier(input.sessionId);
  // The wait is read from this sign-in's own code row, which the auth role owns. It used to count
  // auth_audit_events, which that role may only append to: every send failed with "permission
  // denied", no email went out, and the screen showed that failure as a wrong code.
  const [previous] = await authDb
    .select({ createdAt: verifications.createdAt, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .orderBy(desc(verifications.createdAt))
    .limit(1);
  const now = Date.now();
  const waitSeconds = resendWaitSeconds(previous?.createdAt ?? null, now);
  const previousLeft = previous ? Math.floor((new Date(previous.expiresAt).getTime() - now) / 1000) : 0;
  if (waitSeconds > 0 && previousLeft > 0) {
    // A code went out under a minute ago (a reload, a second tab): that one still works, so say
    // so instead of sending another or showing an error.
    return {
      sent: true as const,
      alreadySent: true as const,
      expiresInSeconds: previousLeft,
      resendInSeconds: waitSeconds,
    };
  }

  const provider = createEmailProvider();
  const code = generateOtp(input.email);
  const expiresAt = new Date(now + POLICY.expiresInSeconds * 1000);

  await authDb.delete(verifications).where(eq(verifications.identifier, identifier));
  await authDb.insert(verifications).values({
    identifier,
    value: JSON.stringify({ hash: hashOtp(code), attempts: 0 }),
    expiresAt,
  });

  try {
    await provider.sendOtp({
      email: input.email,
      otp: code,
      type: "sign-in",
    });
  } catch (error) {
    // No code went out, so the wait must not block the retry.
    await authDb.delete(verifications).where(eq(verifications.identifier, identifier));
    throw new Email2faDeliveryError(error instanceof Error ? error.name : "unknown");
  }

  // The email is already out: a failed audit row must not tell the person nothing was sent.
  await auditAuthEvent({
    action: "email_2fa.sent",
    email: input.email,
    userId: input.userId,
    success: true,
    metadata: { sessionId: input.sessionId },
  }).catch(() => undefined);

  return {
    sent: true as const,
    alreadySent: false as const,
    expiresInSeconds: POLICY.expiresInSeconds,
    resendInSeconds: POLICY.resendCooldownSeconds,
  };
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
