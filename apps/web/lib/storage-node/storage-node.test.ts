// Cloud-side storage-node helpers: heartbeat staleness maths, pairing-code maths, token
// hashing, byte formatting, base-URL validation.

import { describe, expect, it } from "vitest";
import {
  DEGRADED_AFTER_MS,
  OFFLINE_AFTER_MS,
  formatBytes,
  isValidSha256,
  nodeLiveness,
  normalizeBaseUrl,
} from ".";
import { PAIRING_CODE_ALPHABET, generatePairingCode, hashSha256Hex, normalizePairingCode } from "./pairing";

const NOW = Date.parse("2026-08-24T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("heartbeat staleness", () => {
  it("is never before the first heartbeat, and for unparseable timestamps", () => {
    expect(nodeLiveness(null, NOW)).toBe("never");
    expect(nodeLiveness("not-a-date", NOW)).toBe("never");
  });

  it("is online within the 5-minute window", () => {
    expect(nodeLiveness(iso(0), NOW)).toBe("online");
    expect(nodeLiveness(iso(DEGRADED_AFTER_MS), NOW)).toBe("online");
  });

  it("degrades after a >5-minute gap and goes offline after 30", () => {
    expect(nodeLiveness(iso(DEGRADED_AFTER_MS + 1), NOW)).toBe("degraded");
    expect(nodeLiveness(iso(OFFLINE_AFTER_MS), NOW)).toBe("degraded");
    expect(nodeLiveness(iso(OFFLINE_AFTER_MS + 1), NOW)).toBe("offline");
  });
});

describe("pairing-code maths", () => {
  it("generates XXXX-XXXX codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      for (const ch of code.replace("-", "")) expect(PAIRING_CODE_ALPHABET.includes(ch)).toBe(true);
    }
  });

  it("excludes lookalike characters entirely", () => {
    for (const ch of "IO01") expect(PAIRING_CODE_ALPHABET.includes(ch)).toBe(false);
  });

  it("normalizes user-typed codes and round-trips generated ones", () => {
    const code = generatePairingCode();
    expect(normalizePairingCode(code)).toBe(code.replace("-", ""));
    expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizePairingCode("ABC")).toBeNull();
    expect(normalizePairingCode("ABCD-EFG0")).toBeNull();
    expect(normalizePairingCode(undefined)).toBeNull();
  });
});

describe("token hashing", () => {
  it("is deterministic sha256 hex, so only hashes ever reach the database", () => {
    expect(hashSha256Hex("token")).toBe(hashSha256Hex("token"));
    expect(hashSha256Hex("token")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSha256Hex("token")).not.toBe(hashSha256Hex("token2"));
  });
});

describe("sha + byte formatting", () => {
  it("validates content shas strictly", () => {
    expect(isValidSha256("a".repeat(64))).toBe(true);
    expect(isValidSha256("A".repeat(64))).toBe(false);
    expect(isValidSha256("a".repeat(63))).toBe(false);
  });

  it("formats bytes and admits unknown", () => {
    expect(formatBytes(null)).toBe("unknown");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("base URL validation", () => {
  it("accepts http(s) origins and paths, dropping trailing slashes", () => {
    expect(normalizeBaseUrl("https://pi.tailnet.ts.net/")).toBe("https://pi.tailnet.ts.net");
    expect(normalizeBaseUrl("http://192.168.1.20:8788")).toBe("http://192.168.1.20:8788");
    expect(normalizeBaseUrl("https://tunnel.example.com/storage/")).toBe("https://tunnel.example.com/storage");
  });

  it("rejects other protocols, credentials, queries, and garbage", () => {
    expect(normalizeBaseUrl("ftp://pi.local")).toBeNull();
    expect(normalizeBaseUrl("https://user:pass@pi.local")).toBeNull();
    expect(normalizeBaseUrl("https://pi.local/?x=1")).toBeNull();
    expect(normalizeBaseUrl("not a url")).toBeNull();
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl(42)).toBeNull();
  });
});
