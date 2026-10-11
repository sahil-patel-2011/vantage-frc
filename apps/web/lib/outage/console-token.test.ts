import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONSOLE_TOKEN_TTL_MS, consoleTokenFromRequest, signConsoleToken, verifyConsoleToken } from "./console-token";

const env = { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough", NODE_ENV: "production" };
const NOW = Date.parse("2026-10-11T12:00:00Z");

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("outage console token", () => {
  it("round-trips the incident id and expires after 24 hours", () => {
    const token = signConsoleToken("incident_123", env, NOW)!;
    expect(token.split(".")).toHaveLength(2);
    const payload = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    expect(payload).toEqual({ incidentId: "incident_123", exp: Math.floor((NOW + CONSOLE_TOKEN_TTL_MS) / 1000), purpose: "outage-console" });

    expect(verifyConsoleToken(token, env, NOW + 60_000)).toEqual({
      ok: true,
      incidentId: "incident_123",
      expiresAt: Math.floor((NOW + CONSOLE_TOKEN_TTL_MS) / 1000) * 1000,
    });
    expect(verifyConsoleToken(token, env, NOW + CONSOLE_TOKEN_TTL_MS + 1_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a tampered payload or signature", () => {
    const token = signConsoleToken("incident_123", env, NOW)!;
    const [body, sig] = token.split(".") as [string, string];
    const forgedBody = b64({ incidentId: "incident_999", exp: Math.floor(NOW / 1000) + 3600, purpose: "outage-console" });
    expect(verifyConsoleToken(`${forgedBody}.${sig}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyConsoleToken(`${body}.${flipped}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
    // Another deployment's secret.
    expect(verifyConsoleToken(token, { ...env, BETTER_AUTH_SECRET: "other-secret" }, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a correctly signed token made for another purpose", () => {
    const body = b64({ incidentId: "incident_123", exp: Math.floor(NOW / 1000) + 3600, purpose: "google-sheets-mirror" });
    const sig = createHmac("sha256", env.BETTER_AUTH_SECRET).update(`outage-console|${body}`).digest("base64url");
    expect(verifyConsoleToken(`${body}.${sig}`, env, NOW)).toEqual({ ok: false, reason: "purpose" });
  });

  it("refuses malformed input", () => {
    for (const value of [undefined, "", "abc", "a.b.c", "x".repeat(700), 42]) {
      expect(verifyConsoleToken(value, env, NOW)).toMatchObject({ ok: false });
    }
  });

  it("will not sign or verify in production without a secret", () => {
    expect(signConsoleToken("incident_123", { NODE_ENV: "production" }, NOW)).toBeNull();
    expect(verifyConsoleToken("a.b", { NODE_ENV: "production" }, NOW)).toEqual({ ok: false, reason: "secret_missing" });
  });

  it("reads the token from a bearer header, a custom header, or the body", () => {
    const bearer = new Request("https://x.test", { headers: { authorization: "Bearer abc.def" } });
    expect(consoleTokenFromRequest(bearer)).toBe("abc.def");
    const custom = new Request("https://x.test", { headers: { "x-outage-token": "ghi.jkl" } });
    expect(consoleTokenFromRequest(custom)).toBe("ghi.jkl");
    expect(consoleTokenFromRequest(new Request("https://x.test"), { token: "mno.pqr" })).toBe("mno.pqr");
    expect(consoleTokenFromRequest(new Request("https://x.test"), {})).toBeNull();
  });
});

describe("the console cookie", () => {
  it("reads the key from a Cookie header among others, and nothing from a missing one", async () => {
    const { CONSOLE_COOKIE, consoleTokenFromCookieHeader, consoleTokenFromRequest } = await import("./console-token");
    expect(consoleTokenFromCookieHeader(`a=1; ${CONSOLE_COOKIE}=abc.def%3D; b=2`)).toBe("abc.def=");
    expect(consoleTokenFromCookieHeader("a=1")).toBeNull();
    expect(consoleTokenFromCookieHeader(null)).toBeNull();
    const request = new Request("https://vantage.test/api/status/outage", { headers: { cookie: `${CONSOLE_COOKIE}=tok.sig` } });
    expect(consoleTokenFromRequest(request)).toBe("tok.sig");
    // An explicit header still wins over the cookie.
    const both = new Request("https://vantage.test/api/status/outage", { headers: { cookie: `${CONSOLE_COOKIE}=old.sig`, authorization: "Bearer new.sig" } });
    expect(consoleTokenFromRequest(both)).toBe("new.sig");
  });
});
