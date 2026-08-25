// Upload-grant scoping: signature, org, item, op, expiry, byte budget — plus
// the pinned token vector that keeps this TS implementation and the node's
// stdlib implementation (packages/storage-node/server.mjs) in lockstep.

import { describe, expect, it } from "vitest";
import {
  canonicalGrantPayload,
  mintGrantToken,
  verifyGrantToken,
  type GrantPayload,
} from "./grants";

const KEY = "a".repeat(64); // stand-in for sha256(accessKey)
const SHA = "b".repeat(64);
const NOW = 1_700_000_000_000;

function payload(overrides: Partial<GrantPayload> = {}): GrantPayload {
  return {
    v: 1,
    op: "upload",
    org: "org-1",
    sha256: SHA,
    maxBytes: 1024,
    nonce: "nonce-1",
    exp: Math.floor(NOW / 1000) + 600,
    ...overrides,
  };
}

const expectations = { signingKey: KEY, org: "org-1", sha256: SHA, op: "upload" as const, nowMs: NOW };

describe("grant token round trip", () => {
  it("mints and verifies a scoped grant", () => {
    const token = mintGrantToken(payload(), KEY);
    const result = verifyGrantToken(token, expectations);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.maxBytes).toBe(1024);
      expect(result.payload.nonce).toBe("nonce-1");
    }
  });

  it("pins the exact token format shared with the storage node", () => {
    // Same vector asserted in packages/storage-node/server.test.ts — if either
    // implementation drifts, one of the two suites fails.
    const fixed = payload({ nonce: "pin", exp: 1700000600 });
    const token = mintGrantToken(fixed, KEY);
    expect(canonicalGrantPayload(fixed)).toBe(
      `{"v":1,"op":"upload","org":"org-1","sha256":"${SHA}","maxBytes":1024,"nonce":"pin","exp":1700000600}`,
    );
    expect(token).toBe(
      // Signature derived independently of this module: HMAC-SHA256 over
      // "sg1.<base64url(canonical json)>" keyed by the utf8 bytes of KEY.
      "sg1.eyJ2IjoxLCJvcCI6InVwbG9hZCIsIm9yZyI6Im9yZy0xIiwic2hhMjU2IjoiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsIm1heEJ5dGVzIjoxMDI0LCJub25jZSI6InBpbiIsImV4cCI6MTcwMDAwMDYwMH0.8f6ab8fd6250cfab40dfb2b386aedfb4052e469a7e69a95cd7419fb0d4edbc8f",
    );
  });

  it("rejects a tampered signature", () => {
    const token = mintGrantToken(payload(), KEY);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyGrantToken(tampered, expectations)).toMatchObject({ ok: false, reason: "bad signature" });
  });

  it("rejects a token signed with a different node's key", () => {
    const token = mintGrantToken(payload(), "c".repeat(64));
    expect(verifyGrantToken(token, expectations)).toMatchObject({ ok: false, reason: "bad signature" });
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = mintGrantToken(payload(), KEY);
    const parts = token.split(".");
    const bumped = { ...payload(), maxBytes: 10_000_000_000 };
    const forged = `${parts[0]}.${Buffer.from(JSON.stringify(bumped)).toString("base64url")}.${parts[2]}`;
    expect(verifyGrantToken(forged, expectations).ok).toBe(false);
  });

  it("is scoped to one org", () => {
    const token = mintGrantToken(payload({ org: "org-2" }), KEY);
    expect(verifyGrantToken(token, expectations)).toMatchObject({
      ok: false,
      reason: "grant is for a different organization",
    });
  });

  it("is scoped to one sha256", () => {
    const token = mintGrantToken(payload({ sha256: "c".repeat(64) }), KEY);
    expect(verifyGrantToken(token, expectations)).toMatchObject({
      ok: false,
      reason: "grant is for a different item",
    });
  });

  it("is scoped to one operation", () => {
    const token = mintGrantToken(payload({ op: "get" }), KEY);
    expect(verifyGrantToken(token, expectations)).toMatchObject({
      ok: false,
      reason: "grant does not authorize upload",
    });
  });

  it("expires", () => {
    const token = mintGrantToken(payload({ exp: Math.floor(NOW / 1000) - 1 }), KEY);
    expect(verifyGrantToken(token, expectations)).toMatchObject({ ok: false, reason: "grant expired" });
    // Exactly at expiry is expired too (<=).
    const boundary = mintGrantToken(payload({ exp: Math.floor(NOW / 1000) }), KEY);
    expect(verifyGrantToken(boundary, { ...expectations, nowMs: Math.floor(NOW / 1000) * 1000 }).ok).toBe(false);
  });

  it("rejects malformed tokens outright", () => {
    expect(verifyGrantToken("", expectations).ok).toBe(false);
    expect(verifyGrantToken("sg1.only-two-parts", expectations).ok).toBe(false);
    expect(verifyGrantToken("sg2.a.b", expectations).ok).toBe(false);
    expect(verifyGrantToken("not-a-token-at-all", expectations).ok).toBe(false);
  });
});
