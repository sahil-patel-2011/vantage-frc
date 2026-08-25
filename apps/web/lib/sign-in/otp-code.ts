/**
 * Pure formatters for the 6-digit sign-in code step.
 *
 * The code length, TTL, and attempt budget mirror what the server actually
 * enforces: Better Auth `emailOTP({ otpLength: 6, expiresIn: 300 })` for the
 * first factor and `POLICY` in `packages/core/src/email-2fa.ts` for the second.
 * Nothing here invents a code or a delivery state — it only shapes what the
 * user typed and what the API already told us.
 */

export const OTP_LENGTH = 6;

/** `emailOTP({ expiresIn })` / `POLICY.expiresInSeconds` — both 300s today. */
export const DEFAULT_CODE_TTL_SECONDS = 300;

/**
 * Local resend guard. The server's own floor is one minute
 * (`rateLimitedResponse` sends `retry-after: 60`, Better Auth sends
 * `X-Retry-After`), so this only stops accidental double taps; a real 429
 * replaces it with the server's number.
 */
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 30;

/** Longest cooldown we will ever show, so a bad header cannot freeze the UI. */
const MAX_RETRY_AFTER_SECONDS = 15 * 60;

export function normalizeSignInEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Deliberately loose: the server is the authority on whether an address is
 * real. This only decides when the "Continue" button stops being disabled.
 */
export function isLikelyEmail(value: string | null | undefined): boolean {
  const email = normalizeSignInEmail(value);
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/** Same masking the `/api/auth/email-2fa` GET already returns: `j***@team.org`. */
export function maskEmail(value: string | null | undefined): string {
  const email = normalizeSignInEmail(value);
  if (!email.includes("@")) return "";
  return email.replace(/(^.).*(@.*$)/, "$1***$2");
}

/** Keep only digits, cap at the code length — used for typing and for paste. */
export function sanitizeCodeInput(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, OTP_LENGTH);
}

/**
 * Pasting "  123 456 " or "Your Vantage code is 123456" both yield "123456".
 * Falls back to the first run of exactly `OTP_LENGTH` digits when the text
 * carries other numbers (an expiry minute, a team number) alongside the code.
 */
export function codeFromPastedText(value: string | null | undefined): string {
  const raw = value ?? "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= OTP_LENGTH) return digits;
  const exact = raw.match(/\b\d{6}\b/);
  if (exact) return exact[0];
  return digits.slice(0, OTP_LENGTH);
}

export function isCodeComplete(code: string | null | undefined): boolean {
  return sanitizeCodeInput(code).length === OTP_LENGTH;
}

/** One box per slot; empty string where nothing has been typed yet. */
export function codeDigits(code: string | null | undefined): string[] {
  const digits = sanitizeCodeInput(code);
  return Array.from({ length: OTP_LENGTH }, (_, index) => digits[index] ?? "");
}

/** Index of the box the caret sits in — the last box once the code is full. */
export function activeDigitIndex(code: string | null | undefined): number {
  return Math.min(sanitizeCodeInput(code).length, OTP_LENGTH - 1);
}

/** `m:ss` for the code lifetime — "4:59", "0:07". */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/** Short form for the resend button — "45s", "1:20". */
export function formatCooldown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return safe < 60 ? `${safe}s` : formatCountdown(safe);
}

/**
 * Read the server's cooldown. Our own limiter sends `retry-after` (seconds);
 * Better Auth's sends `X-Retry-After`. Anything unparseable falls back to the
 * local default rather than pretending the wait is over.
 */
export function parseRetryAfterSeconds(
  headers: { get(name: string): string | null } | null | undefined,
  fallback = DEFAULT_RESEND_COOLDOWN_SECONDS,
): number {
  const raw = headers?.get("retry-after") ?? headers?.get("x-retry-after") ?? null;
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_RETRY_AFTER_SECONDS);
}

/** Seconds left until `deadline`, floored at 0. Blank deadline means "none". */
export function secondsUntil(deadline: number | null | undefined, now: number): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}
