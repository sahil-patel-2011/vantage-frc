import { describe, expect, it } from "vitest";
import { hashPhoneOtp, normalizePhoneE164, normalizeRecoveryEmail, phoneOtpMatches } from "./phone-otp";

describe("account recovery helpers", () => {
  it("normalizes recovery email and US phone numbers", () => {
    expect(normalizeRecoveryEmail("  Alex@Team.org ")).toBe("alex@team.org");
    expect(normalizeRecoveryEmail("")).toBeNull();
    expect(() => normalizeRecoveryEmail("not-an-email")).toThrow(/recovery email/i);
    expect(normalizePhoneE164("5551234567")).toBe("+15551234567");
    expect(normalizePhoneE164("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhoneE164("")).toBeNull();
    expect(() => normalizePhoneE164("123")).toThrow(/phone/i);
  });

  it("compares OTP hashes without leaking DEMO codes", () => {
    const hash = hashPhoneOtp("user-1", "+15551234567", "123456");
    expect(phoneOtpMatches(hash, hashPhoneOtp("user-1", "+15551234567", "123456"))).toBe(true);
    expect(phoneOtpMatches(hash, hashPhoneOtp("user-1", "+15551234567", "000000"))).toBe(false);
  });
});
