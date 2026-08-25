import { describe, expect, it } from "vitest";
import { email2faSatisfiedByAuthMethod, resolveSessionAuthMethod } from "@vantage/core";
import {
  AUTH_CODE_TTL_SECONDS,
  LINK_REQUEST_TTL_SECONDS,
  USER_CODE_ALPHABET,
  formatUserCode,
  generateAuthCode,
  generateUserCode,
  generateVerifier,
  isAuthCodeShape,
  isChallengeShape,
  isVerifierShape,
  normalizeUserCode,
  sanitizeMachineName,
  sha256Hex,
  verifierMatchesChallenge,
} from "./codes";
import { decideExchange, decidePoll, type DesktopLinkRow } from "./link-state";
import { extractSessionCookie, isSessionCookieName } from "./session-cookie";

describe("user codes", () => {
  it("generates 8 chars in two groups from the ambiguity-free alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateUserCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      for (const char of code.replace("-", "")) {
        expect(USER_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("never contains the ambiguous I/O/0/1 characters", () => {
    expect(USER_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  it("normalizes case and separators, round-tripping with format", () => {
    expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeUserCode(" ab cd ef gh ")).toBe("ABCDEFGH");
    expect(formatUserCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("rejects wrong lengths and out-of-alphabet characters", () => {
    expect(normalizeUserCode("ABC")).toBeNull();
    expect(normalizeUserCode("ABCDEFGHJ")).toBeNull();
    expect(normalizeUserCode("ABCD-EF0H")).toBeNull(); // 0 not in alphabet
    expect(normalizeUserCode("ABCD-EFIH")).toBeNull(); // I not in alphabet
  });
});

describe("verifier / challenge", () => {
  it("hashes with sha256 (known vector)", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("accepts the verifier whose sha256 matches the stored challenge", () => {
    const verifier = generateVerifier();
    expect(isVerifierShape(verifier)).toBe(true);
    const challenge = sha256Hex(verifier);
    expect(isChallengeShape(challenge)).toBe(true);
    expect(verifierMatchesChallenge(verifier, challenge)).toBe(true);
  });

  it("rejects any other verifier — a stolen code alone is useless", () => {
    const challenge = sha256Hex(generateVerifier());
    expect(verifierMatchesChallenge(generateVerifier(), challenge)).toBe(false);
    expect(verifierMatchesChallenge("", challenge)).toBe(false);
    expect(verifierMatchesChallenge("short", challenge)).toBe(false);
    expect(verifierMatchesChallenge(null, challenge)).toBe(false);
    expect(verifierMatchesChallenge(generateVerifier(), "not-a-hash")).toBe(false);
  });

  it("keeps the TTLs inside the security budget", () => {
    expect(AUTH_CODE_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(LINK_REQUEST_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it("generates base64url auth codes that pass their own shape check", () => {
    expect(isAuthCodeShape(generateAuthCode())).toBe(true);
    expect(isAuthCodeShape("has spaces")).toBe(false);
    expect(isAuthCodeShape(42)).toBe(false);
  });
});

describe("machine names", () => {
  it("trims, collapses whitespace, and caps at 80 chars", () => {
    expect(sanitizeMachineName("  SHOP\t\nPC  ")).toBe("SHOP PC");
    expect(sanitizeMachineName("x".repeat(200))).toHaveLength(80);
    expect(sanitizeMachineName("   ")).toBeNull();
    expect(sanitizeMachineName(undefined)).toBeNull();
  });
});

function row(overrides: Partial<DesktopLinkRow> = {}): DesktopLinkRow {
  return {
    approved_user_id: null,
    code_challenge: sha256Hex("verifier"),
    auth_code_hash: null,
    auth_code_expires_at: null,
    consumed_at: null,
    expires_at: new Date("2026-01-01T00:10:00Z"),
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T00:05:00Z");

describe("decidePoll — single release semantics", () => {
  it("is pending before approval", () => {
    expect(decidePoll(row(), NOW)).toEqual({ status: "pending" });
  });

  it("releases exactly once after approval", () => {
    const approved = row({ approved_user_id: "user-1" });
    expect(decidePoll(approved, NOW)).toEqual({ status: "release", userId: "user-1" });
    // The release stamps auth_code_hash — the next poll can never re-issue.
    const released = row({ approved_user_id: "user-1", auth_code_hash: sha256Hex("code") });
    expect(decidePoll(released, NOW)).toEqual({ status: "consumed" });
  });

  it("expires when the request TTL lapses without approval", () => {
    expect(decidePoll(row({ expires_at: new Date("2026-01-01T00:04:59Z") }), NOW)).toEqual({
      status: "expired",
    });
  });

  it("reports consumed for spent rows and expired for missing ones", () => {
    expect(decidePoll(row({ consumed_at: NOW }), NOW)).toEqual({ status: "consumed" });
    expect(decidePoll(undefined, NOW)).toEqual({ status: "expired" });
  });
});

describe("decideExchange — one-time code + proof of possession", () => {
  const verifier = generateVerifier();
  const ready = () =>
    row({
      approved_user_id: "user-1",
      code_challenge: sha256Hex(verifier),
      auth_code_hash: sha256Hex("released-code"),
      auth_code_expires_at: new Date("2026-01-01T00:09:00Z"),
    });

  it("succeeds with the original verifier and binds to the approving user", () => {
    expect(decideExchange(ready(), verifier, NOW)).toEqual({ ok: true, userId: "user-1" });
  });

  it("rejects the right code with the wrong verifier", () => {
    expect(decideExchange(ready(), generateVerifier(), NOW)).toEqual({
      ok: false,
      reason: "verifier_mismatch",
    });
  });

  it("is single-use: a consumed row never exchanges again", () => {
    expect(decideExchange({ ...ready(), consumed_at: NOW }, verifier, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an expired authorization code", () => {
    const stale = { ...ready(), auth_code_expires_at: new Date("2026-01-01T00:04:00Z") };
    expect(decideExchange(stale, verifier, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects unapproved or unreleased rows and unknown codes", () => {
    expect(decideExchange({ ...ready(), approved_user_id: null }, verifier, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(decideExchange({ ...ready(), auth_code_hash: null }, verifier, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(decideExchange(undefined, verifier, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("session cookie extraction", () => {
  it("recognizes both Better Auth session cookie names", () => {
    expect(isSessionCookieName("better-auth.session_token")).toBe(true);
    expect(isSessionCookieName("__Secure-better-auth.session_token")).toBe(true);
    expect(isSessionCookieName("better-auth.session_data")).toBe(false);
  });

  it("extracts the session cookie with its raw (still-encoded) value", () => {
    const value = "token.sig%2Fbase64%3D";
    const cookie = extractSessionCookie([
      "better-auth.session_data=cache; Path=/; HttpOnly",
      `__Secure-better-auth.session_token=${value}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ], new Date("2026-01-01T00:00:00Z"));
    expect(cookie).toEqual({
      name: "__Secure-better-auth.session_token",
      value,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expiresAt: "2026-01-08T00:00:00.000Z",
    });
  });

  it("falls back to Expires when Max-Age is absent", () => {
    const cookie = extractSessionCookie([
      "better-auth.session_token=abc.def; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; HttpOnly",
    ]);
    expect(cookie?.expiresAt).toBe(new Date("Wed, 21 Oct 2026 07:28:00 GMT").toISOString());
    expect(cookie?.secure).toBe(false);
  });

  it("returns null when no session cookie is present", () => {
    expect(extractSessionCookie([])).toBeNull();
    expect(extractSessionCookie(["other=1; Path=/"])).toBeNull();
    expect(extractSessionCookie(["better-auth.session_token=; Path=/"])).toBeNull();
  });
});

describe("auth method wiring", () => {
  it("maps the plugin's endpoint path to desktop_link", () => {
    expect(resolveSessionAuthMethod("/desktop-link/session")).toBe("desktop_link");
  });

  it("treats desktop_link as second-factor-satisfied (approval was 2FA-gated)", () => {
    expect(email2faSatisfiedByAuthMethod("desktop_link", true)).toBe(true);
    expect(email2faSatisfiedByAuthMethod("unknown", true)).toBe(false);
  });
});
