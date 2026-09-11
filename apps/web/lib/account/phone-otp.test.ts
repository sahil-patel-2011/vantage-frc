import { afterEach, describe, expect, it } from "vitest";
import {
  hashPhoneOtp,
  normalizePhoneE164,
  normalizeRecoveryEmail,
  phoneOtpMatches,
  phoneOtpSetupStatus,
} from "./phone-otp";

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

describe("phoneOtpSetupStatus", () => {
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  function stash() {
    for (const key of keys) previous.set(key, process.env[key]);
  }

  it("tells the student what to do when text messaging is missing", () => {
    stash();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    const status = phoneOtpSetupStatus();
    expect(status.configured).toBe(false);
    expect(status.message).toMatch(/text messaging/i);
    expect(status.message).not.toMatch(/TWILIO_/);
    expect(status.message).not.toMatch(/\bOTP\b/);
  });

  it("does not name Twilio when text messaging is configured", () => {
    stash();
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+15551234567";
    const status = phoneOtpSetupStatus();
    expect(status.configured).toBe(true);
    expect(status.message).toMatch(/text a code/i);
    expect(status.message).not.toMatch(/Twilio/i);
    expect(status.message).not.toMatch(/\bOTP\b/);
  });
});
