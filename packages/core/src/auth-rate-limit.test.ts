import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT_DEFAULT, AUTH_RATE_LIMIT_RULES } from "./auth-rate-limit";

/** Requests a minute one address may send to a path. */
const perMinute = (rule: { window: number; max: number }) => (rule.max * 60) / rule.window;

describe("auth request limits for a team on one network", () => {
  it("lets thirty people load pages from one address without a 429 on the session check", () => {
    // Thirty people, a page load or focus refresh every three seconds each.
    expect(perMinute(AUTH_RATE_LIMIT_RULES["/get-session"]!)).toBeGreaterThanOrEqual(30 * 20);
    expect(perMinute(AUTH_RATE_LIMIT_RULES["/get-session"]!)).toBeGreaterThan(perMinute(AUTH_RATE_LIMIT_DEFAULT));
  });

  it("lets a whole team start Google sign-in together", () => {
    expect(perMinute(AUTH_RATE_LIMIT_RULES["/sign-in/social"]!)).toBeGreaterThanOrEqual(60);
  });

  it("leaves the code and password routes on their strict limits", () => {
    for (const path of [
      "/email-otp/send-verification-otp",
      "/email-otp/check-verification-otp",
      "/sign-in/email-otp",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
    ]) {
      expect(AUTH_RATE_LIMIT_RULES[path], path).toBeUndefined();
    }
    // No wildcard that would catch them either.
    for (const key of Object.keys(AUTH_RATE_LIMIT_RULES)) {
      expect(key.startsWith("/sign-in/*") || key === "/*" || key.startsWith("/email-otp")).toBe(false);
    }
  });

  it("names paths the way Better Auth matches them (relative to /api/auth)", () => {
    for (const key of Object.keys(AUTH_RATE_LIMIT_RULES)) {
      expect(key).toMatch(/^\/[a-z]/);
      expect(key.startsWith("/api/")).toBe(false);
    }
  });

  it("is the configuration the auth instance uses", () => {
    const source = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(source).toMatch(/customRules:\s*AUTH_RATE_LIMIT_RULES/);
    expect(source).toMatch(/\.\.\.AUTH_RATE_LIMIT_DEFAULT/);
  });
});
