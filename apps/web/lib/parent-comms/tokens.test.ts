import { describe, expect, it } from "vitest";
import { assertToken, isParentToken, newParentToken, PARENT_TOKEN_PATTERN } from "./tokens";

describe("newParentToken", () => {
  it("generates tokens inside the 0144 charset and length window", () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newParentToken();
      expect(token).toMatch(PARENT_TOKEN_PATTERN);
      expect(token.length).toBeGreaterThanOrEqual(16);
      expect(token.length).toBeLessThanOrEqual(100);
    }
  });

  it("generates distinct tokens", () => {
    const seen = new Set(Array.from({ length: 100 }, () => newParentToken()));
    expect(seen.size).toBe(100);
  });
});

describe("isParentToken", () => {
  it("accepts the generated shape", () => {
    expect(isParentToken(newParentToken())).toBe(true);
    expect(isParentToken("A".repeat(16))).toBe(true);
    expect(isParentToken("a-b_c".padEnd(100, "x"))).toBe(true);
  });

  it("rejects short, long, and out-of-charset values", () => {
    expect(isParentToken("short")).toBe(false);
    expect(isParentToken("x".repeat(101))).toBe(false);
    expect(isParentToken("has spaces here!")).toBe(false);
    expect(isParentToken("semi;colon-injection")).toBe(false);
    expect(isParentToken(null)).toBe(false);
    expect(isParentToken(42)).toBe(false);
  });
});

describe("assertToken", () => {
  it("returns the token when valid", () => {
    const token = newParentToken();
    expect(assertToken(token)).toBe(token);
  });

  it("throws on anything else", () => {
    expect(() => assertToken("nope")).toThrow("invalid_token");
    expect(() => assertToken(undefined)).toThrow("invalid_token");
  });
});
