import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { auditAuthEvent, createEmailProvider, deterministicLocalOtp, hashEmail } from "./email";

/**
 * A second, verified email for account recovery (migration 0683).
 *
 * Adding one: the signed-in person enters an address, gets a 6-digit code there, and
 * types it back — only then does it count. Using one: on the sign-in page, "Use my
 * recovery email" sends a code to that address and, when it is typed back, signs the
 * owner in exactly like an emailed sign-in code (auth method email_otp).
 *
 * Every change and every recovery sign-in is announced to the main address, so a
 * recovery address someone else added cannot be used quietly. Requests for an address
 * that is not anyone's recovery email get the same answer as real ones, so the form
 * cannot be used to find out who has an account.
 */

const POLICY = {
  expiresInSeconds: 600,
  allowedAttempts: 5,
  windowSeconds: 600,
  sendLimit: 4,
} as const;

export class RecoveryEmailError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RecoveryEmailError";
  }
}

export function normalizeRecoveryEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isRecoveryEmailShape(email: string): boolean {
  return email.length >= 6 && email.length <= 254 && !/\s/.test(email) && /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

function hashCode(scope: string, code: string) {
  return createHash("sha256").update(`${scope}:${code.trim()}`).digest("hex");
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function newCode(email: string, purpose: string) {
  if (process.env.NODE_ENV !== "production") return deterministicLocalOtp(email, purpose);
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

type Query = <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

async function withAuthDb<T>(work: (query: Query) => Promise<T>): Promise<T> {
  const connectionString = firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL");
  if (!connectionString) throw new RecoveryEmailError("Recovery email is not available right now.", 503);
  const pool = createSqlPool(connectionString, { max: 1 });
  try {
    return await work(async (sql, params = []) => (await pool.query(sql, params)).rows);
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      throw new RecoveryEmailError("Recovery email is being set up. Try again in a few minutes.", 503);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

/** Counts recent sends for a key and records this one; throws when over the limit. */
async function takeSendSlot(query: Query, key: string) {
  await query(`DELETE FROM auth_recovery_sends WHERE created_at < now() - interval '1 day'`);
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM auth_recovery_sends
      WHERE key = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
    [key, String(POLICY.windowSeconds)],
  );
  if (Number(rows[0]?.count ?? 0) >= POLICY.sendLimit) {
    throw new RecoveryEmailError("Too many codes sent. Wait ten minutes and try again.", 429);
  }
  await query(`INSERT INTO auth_recovery_sends (key) VALUES ($1)`, [key]);
}

async function storeChallenge(query: Query, identifier: string, payload: Record<string, unknown>) {
  await query(`DELETE FROM verifications WHERE identifier = $1`, [identifier]);
  await query(
    `INSERT INTO verifications (identifier, value, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [identifier, JSON.stringify({ ...payload, attempts: 0 }), String(POLICY.expiresInSeconds)],
  );
}

/** One string field of a stored challenge, or "" when there is none. */
function challengeField(value: string | undefined, field: "email" | "userId"): string {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return typeof parsed[field] === "string" ? (parsed[field] as string) : "";
  } catch {
    return "";
  }
}

/** Check a code against a stored challenge; consumes it on success or after too many tries. */
async function consumeChallenge<P extends { hash: string; attempts: number }>(
  query: Query,
  identifier: string,
  scope: string,
  code: string,
): Promise<P> {
  const rows = await query<{ id: string; value: string }>(
    `SELECT id::text, value FROM verifications WHERE identifier = $1 AND expires_at > now() LIMIT 1`,
    [identifier],
  );
  const row = rows[0];
  const expired = new RecoveryEmailError("That code has expired. Send a new one.");
  if (!row) throw expired;
  let payload: P;
  try {
    payload = JSON.parse(row.value) as P;
  } catch {
    throw expired;
  }
  if ((payload.attempts ?? 0) >= POLICY.allowedAttempts) {
    await query(`DELETE FROM verifications WHERE id = $1::uuid`, [row.id]);
    throw new RecoveryEmailError("Too many tries. Send a new code.");
  }
  if (!/^\d{6}$/.test(code.trim()) || !sameHash(payload.hash, hashCode(scope, code))) {
    await query(`UPDATE verifications SET value = $2 WHERE id = $1::uuid`, [
      row.id,
      JSON.stringify({ ...payload, attempts: (payload.attempts ?? 0) + 1 }),
    ]);
    throw new RecoveryEmailError("That code isn't right. Check the email and try again.");
  }
  await query(`DELETE FROM verifications WHERE id = $1::uuid`, [row.id]);
  return payload;
}

async function notifyMainAddress(email: string, subject: string, message: string) {
  try {
    await createEmailProvider().sendSecurityNotice({ email, subject, message });
  } catch {
    // A notice that cannot be delivered never blocks the person's own action.
  }
}

async function sendCode(email: string, code: string) {
  try {
    await createEmailProvider().sendOtp({ email, otp: code, type: "sign-in" });
  } catch {
    throw new RecoveryEmailError("We couldn't send the email. Try again in a minute.", 503);
  }
}

// ------------------------------------------------------------------ account settings

export type RecoveryEmailState = { email: string; verified: boolean } | null;

export async function getRecoveryEmail(userId: string): Promise<RecoveryEmailState> {
  return withAuthDb(async (query) => {
    const rows = await query<{ email: string; verified: boolean }>(
      `SELECT email, verified_at IS NOT NULL AS verified FROM user_recovery_emails WHERE user_id = $1::uuid`,
      [userId],
    );
    return rows[0] ?? null;
  });
}

/** Send a code to a new recovery address. Nothing is saved until the code comes back. */
export async function startRecoveryEmailChange(input: { userId: string; primaryEmail: string; email: unknown }) {
  const email = normalizeRecoveryEmail(input.email);
  if (!isRecoveryEmailShape(email)) throw new RecoveryEmailError("Enter a full email address.");
  if (email === normalizeRecoveryEmail(input.primaryEmail)) {
    throw new RecoveryEmailError("Use a different address from the one you sign in with.");
  }
  await withAuthDb(async (query) => {
    const taken = await query(
      `SELECT 1 FROM users WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM user_recovery_emails WHERE email = $1 AND verified_at IS NOT NULL AND user_id <> $2::uuid
       LIMIT 1`,
      [email, input.userId],
    );
    if (taken.length) throw new RecoveryEmailError("That address is already used by another Vantage account.");
    await takeSendSlot(query, `add:${input.userId}`);
    const code = newCode(email, "recovery-email-add");
    const scope = `add:${input.userId}:${email}`;
    await storeChallenge(query, `recovery-email-add:${input.userId}`, { hash: hashCode(scope, code), email });
    await sendCode(email, code);
  });
  await auditAuthEvent({ action: "recovery_email.code_sent", userId: input.userId, email, success: true });
  return { email };
}

/** Confirm the code sent to the new address and save it as the recovery email. */
export async function confirmRecoveryEmailChange(input: { userId: string; primaryEmail: string; code: unknown }) {
  const code = typeof input.code === "string" ? input.code : "";
  const email = await withAuthDb(async (query) => {
    const pending = await query<{ value: string }>(
      `SELECT value FROM verifications WHERE identifier = $1 AND expires_at > now() LIMIT 1`,
      [`recovery-email-add:${input.userId}`],
    );
    const target = challengeField(pending[0]?.value, "email");
    if (!target) throw new RecoveryEmailError("That code has expired. Send a new one.");
    await consumeChallenge(query, `recovery-email-add:${input.userId}`, `add:${input.userId}:${target}`, code);
    try {
      await query(
        `INSERT INTO user_recovery_emails (user_id, email, verified_at)
         VALUES ($1::uuid, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, verified_at = now(), updated_at = now()`,
        [input.userId, target],
      );
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        throw new RecoveryEmailError("That address is already used by another Vantage account.");
      }
      throw error;
    }
    return target;
  });
  await auditAuthEvent({ action: "recovery_email.added", userId: input.userId, email, success: true });
  await notifyMainAddress(
    input.primaryEmail,
    "Recovery email added to your Vantage account",
    `${email} was added as the recovery email for your Vantage account. It can be used to sign in if you lose access to this address.\n\nIf this wasn't you, sign in and remove it under Account, then tell your team's admin.`,
  );
  return { email };
}

export async function removeRecoveryEmail(input: { userId: string; primaryEmail: string }) {
  const removed = await withAuthDb(async (query) => {
    await query(`DELETE FROM verifications WHERE identifier = $1`, [`recovery-email-add:${input.userId}`]);
    return query<{ email: string }>(`DELETE FROM user_recovery_emails WHERE user_id = $1::uuid RETURNING email`, [
      input.userId,
    ]);
  });
  if (removed[0]) {
    await auditAuthEvent({ action: "recovery_email.removed", userId: input.userId, success: true });
    await notifyMainAddress(
      input.primaryEmail,
      "Recovery email removed from your Vantage account",
      `${removed[0].email} is no longer the recovery email for your Vantage account.\n\nIf this wasn't you, sign in and add it back under Account, then tell your team's admin.`,
    );
  }
  return { removed: Boolean(removed[0]) };
}

// ------------------------------------------------------------------ signing in with it

/**
 * Send a sign-in code to a recovery address. Always resolves the same way whether or not
 * the address belongs to anyone; only a real, verified recovery address receives a code.
 */
export async function requestRecoverySignIn(input: { email: unknown }): Promise<void> {
  const email = normalizeRecoveryEmail(input.email);
  if (!isRecoveryEmailShape(email)) throw new RecoveryEmailError("Enter a full email address.");
  const emailHash = hashEmail(email);
  const owner = await withAuthDb(async (query) => {
    await takeSendSlot(query, `signin:${emailHash}`);
    const rows = await query<{ userId: string }>(
      `SELECT user_id::text AS "userId" FROM user_recovery_emails WHERE email = $1 AND verified_at IS NOT NULL LIMIT 1`,
      [email],
    );
    const userId = rows[0]?.userId;
    if (!userId) return null;
    const code = newCode(email, "recovery-signin");
    await storeChallenge(query, `recovery-signin:${email}`, { hash: hashCode(`signin:${userId}`, code), userId });
    await sendCode(email, code);
    return userId;
  });
  await auditAuthEvent({
    action: "recovery_signin.requested",
    email,
    userId: owner ?? undefined,
    success: Boolean(owner),
  });
}

/** Check the code sent to a recovery address; returns the account to sign in. */
export async function verifyRecoverySignIn(input: { email: unknown; code: unknown }): Promise<{ userId: string }> {
  const email = normalizeRecoveryEmail(input.email);
  const code = typeof input.code === "string" ? input.code : "";
  if (!isRecoveryEmailShape(email)) throw new RecoveryEmailError("Enter a full email address.");
  const result = await withAuthDb(async (query) => {
    const rows = await query<{ value: string }>(
      `SELECT value FROM verifications WHERE identifier = $1 AND expires_at > now() LIMIT 1`,
      [`recovery-signin:${email}`],
    );
    const userId = challengeField(rows[0]?.value, "userId");
    if (!userId) throw new RecoveryEmailError("That code has expired. Send a new one.");
    await consumeChallenge(query, `recovery-signin:${email}`, `signin:${userId}`, code);
    // Still this person's verified recovery address at the moment of sign-in.
    const current = await query<{ primaryEmail: string }>(
      `SELECT u.email AS "primaryEmail" FROM user_recovery_emails r JOIN users u ON u.id = r.user_id
        WHERE r.user_id = $1::uuid AND r.email = $2 AND r.verified_at IS NOT NULL`,
      [userId, email],
    );
    if (!current[0]) throw new RecoveryEmailError("That code has expired. Send a new one.");
    return { userId, primary: current[0].primaryEmail };
  });
  await auditAuthEvent({ action: "recovery_signin.verified", email, userId: result.userId, success: true });
  await notifyMainAddress(
    result.primary,
    "Signed in to Vantage with your recovery email",
    `Someone just signed in to your Vantage account with a code sent to your recovery email (${email}).\n\nIf this wasn't you, sign in, remove the recovery email under Account, and tell your team's admin.`,
  );
  return { userId: result.userId };
}
