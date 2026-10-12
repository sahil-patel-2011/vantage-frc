import { describe, expect, it } from "vitest";
import { EMAIL_2FA_POLICY, resendWaitSeconds } from "./email-2fa";

describe("second-factor code timing", () => {
  it("codes last thirty minutes, one new code a minute", () => {
    expect(EMAIL_2FA_POLICY.expiresInSeconds).toBe(30 * 60);
    expect(EMAIL_2FA_POLICY.resendCooldownSeconds).toBe(60);
  });

  it("counts the wait from the last code sent", () => {
    const sentAt = new Date("2026-10-12T18:00:00Z");
    const at = (seconds: number) => sentAt.getTime() + seconds * 1000;
    expect(resendWaitSeconds(null, at(0))).toBe(0);
    expect(resendWaitSeconds(sentAt, at(0))).toBe(60);
    expect(resendWaitSeconds(sentAt, at(45))).toBe(15);
    expect(resendWaitSeconds(sentAt.toISOString(), at(59.5))).toBe(1);
    expect(resendWaitSeconds(sentAt, at(60))).toBe(0);
    // A clock skewed into the future never asks for more than one minute.
    expect(resendWaitSeconds(sentAt, at(-600))).toBe(60);
  });
});
