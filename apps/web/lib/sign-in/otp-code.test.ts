import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  OTP_LENGTH,
  activeDigitIndex,
  codeDigits,
  codeFromPastedText,
  formatCooldown,
  formatCountdown,
  isCodeComplete,
  isLikelyEmail,
  maskEmail,
  normalizeSignInEmail,
  parseRetryAfterSeconds,
  sanitizeCodeInput,
  secondsUntil,
} from "./otp-code";

/**
 * Header fixtures use the two real shapes this app can receive:
 *   - `retry-after` — set by `apps/web/lib/rate-limit.ts` `rateLimitedResponse`
 *   - `x-retry-after` — Better Auth's own limiter header
 * Nothing here is an invented API response.
 */
function headersFrom(entries: Record<string, string>) {
  return new Headers(entries);
}

describe("sign-in code formatters", () => {
  it("normalizes and loosely validates the address without judging the account", () => {
    expect(normalizeSignInEmail("  Scout@Team254.org ")).toBe("scout@team254.org");
    expect(isLikelyEmail("scout@team254.org")).toBe(true);
    expect(isLikelyEmail("scout@localhost")).toBe(false);
    expect(isLikelyEmail("no-at-sign.org")).toBe(false);
    expect(isLikelyEmail("has space@team.org")).toBe(false);
    expect(isLikelyEmail("")).toBe(false);
  });

  it("masks the address the same way /api/auth/email-2fa does", () => {
    expect(maskEmail("scout@team254.org")).toBe("s***@team254.org");
    expect(maskEmail("not-an-email")).toBe("");
  });

  it("keeps only digits and caps at the code length", () => {
    expect(sanitizeCodeInput("12-34 56")).toBe("123456");
    expect(sanitizeCodeInput("1234567890")).toBe("123456");
    expect(sanitizeCodeInput(null)).toBe("");
    expect(isCodeComplete("12345")).toBe(false);
    expect(isCodeComplete("123456")).toBe(true);
  });

  it("recovers the code from a pasted email line", () => {
    expect(codeFromPastedText("  123 456 ")).toBe("123456");
    // Real mail body shape: the code sits among other numbers.
    expect(codeFromPastedText("Your Vantage code is 402917 and expires in 5 minutes")).toBe("402917");
    expect(codeFromPastedText("4029")).toBe("4029");
    expect(codeFromPastedText("")).toBe("");
  });

  it("lays out one box per slot with the caret on the next empty slot", () => {
    expect(codeDigits("407")).toEqual(["4", "0", "7", "", "", ""]);
    expect(codeDigits("")).toHaveLength(OTP_LENGTH);
    expect(activeDigitIndex("407")).toBe(3);
    expect(activeDigitIndex("")).toBe(0);
    // A full code parks the caret on the last box rather than out of range.
    expect(activeDigitIndex("402917")).toBe(OTP_LENGTH - 1);
  });

  it("formats the code lifetime and the resend cooldown differently", () => {
    expect(formatCountdown(299)).toBe("4:59");
    expect(formatCountdown(7)).toBe("0:07");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCooldown(45)).toBe("45s");
    expect(formatCooldown(80)).toBe("1:20");
  });

  it("reads the server's cooldown from either limiter header", () => {
    expect(parseRetryAfterSeconds(headersFrom({ "retry-after": "60" }))).toBe(60);
    expect(parseRetryAfterSeconds(headersFrom({ "x-retry-after": "12" }))).toBe(12);
    // A garbage or absent header must not pretend the wait is over.
    expect(parseRetryAfterSeconds(headersFrom({ "retry-after": "soon" }))).toBe(
      DEFAULT_RESEND_COOLDOWN_SECONDS,
    );
    expect(parseRetryAfterSeconds(null)).toBe(DEFAULT_RESEND_COOLDOWN_SECONDS);
    // A hostile value cannot freeze the button forever.
    expect(parseRetryAfterSeconds(headersFrom({ "retry-after": "99999" }))).toBe(15 * 60);
  });

  it("counts down to a deadline and floors at zero", () => {
    const now = 1_700_000_000_000;
    expect(secondsUntil(now + 30_000, now)).toBe(30);
    expect(secondsUntil(now - 1_000, now)).toBe(0);
    expect(secondsUntil(null, now)).toBe(0);
  });
});
