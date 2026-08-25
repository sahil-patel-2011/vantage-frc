// Tests for the pure parts of the self-hosted storage node (packages/storage-node/server.mjs).
// The service itself is stdlib-only and single-file; everything that can be wrong in a way a
// unit test can catch — shard layout, hashing, Range parsing, quota, scrub honesty, CLI flags,
// pairing-code normalization — is exported and tested here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  DEFAULT_QUOTA_GB,
  PAIRING_CODE_ALPHABET,
  computeScrubReport,
  formatBytes,
  isValidSha256,
  lanUrlsFor,
  normalizePairingCode,
  parseArgs,
  parseRange,
  quotaDecision,
  sha256Hex,
  shardRelPath,
  timingSafeEqualHex,
  // @ts-expect-error -- stdlib-only .mjs service ships without type declarations on purpose
} from "./server.mjs";

const SHA_A = "a".repeat(64);

describe("sha256 validation and shard layout", () => {
  it("accepts only 64-char lowercase hex", () => {
    expect(isValidSha256(SHA_A)).toBe(true);
    expect(isValidSha256(sha256Hex("hello"))).toBe(true);
    expect(isValidSha256("A".repeat(64))).toBe(false);
    expect(isValidSha256("a".repeat(63))).toBe(false);
    expect(isValidSha256("g".repeat(64))).toBe(false);
    expect(isValidSha256(null)).toBe(false);
  });

  it("shards items two levels deep by hash prefix", () => {
    const sha = sha256Hex("robot");
    expect(shardRelPath(sha)).toBe(`${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`);
    expect(() => shardRelPath("not-a-sha")).toThrow();
  });

  it("hashes deterministically to hex", () => {
    expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("token hashing comparison", () => {
  it("matches equal digests and rejects everything else without throwing", () => {
    const digest = sha256Hex("token-1");
    expect(timingSafeEqualHex(digest, sha256Hex("token-1"))).toBe(true);
    expect(timingSafeEqualHex(digest, sha256Hex("token-2"))).toBe(false);
    expect(timingSafeEqualHex(digest, digest.slice(1))).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
    expect(timingSafeEqualHex(digest, "zz".repeat(32))).toBe(false);
  });
});

describe("pairing-code maths", () => {
  it("normalizes dashes, spaces, and case", () => {
    expect(normalizePairingCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizePairingCode(" AB CD EF GH ")).toBe("ABCDEFGH");
  });

  it("rejects wrong lengths and ambiguous characters outside the alphabet", () => {
    expect(normalizePairingCode("ABCDEFG")).toBeNull();
    expect(normalizePairingCode("ABCDEFGHI")).toBeNull();
    expect(normalizePairingCode("ABCD-EFG1")).toBeNull(); // 1 is excluded
    expect(normalizePairingCode("ABCD-EFG0")).toBeNull(); // 0 is excluded
    expect(normalizePairingCode("ABCD-EFGO")).toBeNull(); // O is excluded
    expect(normalizePairingCode("ABCD-EFGI")).toBeNull(); // I is excluded
    expect(normalizePairingCode(42 as unknown as string)).toBeNull();
  });

  it("uses an alphabet with no lookalike characters", () => {
    for (const ch of "IO01") expect(PAIRING_CODE_ALPHABET.includes(ch)).toBe(false);
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
  });
});

describe("Range parsing", () => {
  it("returns null when there is no header (serve full 200)", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("", 100)).toBeNull();
  });

  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=200-", 1000)).toEqual({ start: 200, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps an end past the resource size", () => {
    expect(parseRange("bytes=500-99999", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("marks unsatisfiable ranges invalid (416)", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=5-2", 1000)).toBe("invalid");
    expect(parseRange("bytes=-0", 1000)).toBe("invalid");
    expect(parseRange("bytes=-10", 0)).toBe("invalid");
  });

  it("ignores malformed and multi-range headers (serve full 200)", () => {
    expect(parseRange("bytes=0-10,20-30", 1000)).toBeNull();
    expect(parseRange("items=0-10", 1000)).toBeNull();
    expect(parseRange("bytes=a-b", 1000)).toBeNull();
  });
});

describe("quota enforcement", () => {
  it("allows writes that fit and rejects writes that do not", () => {
    expect(quotaDecision({ usedBytes: 0, incomingBytes: 100, quotaBytes: 100 })).toEqual({
      allowed: true,
      remainingBytes: 100,
    });
    expect(quotaDecision({ usedBytes: 50, incomingBytes: 51, quotaBytes: 100 })).toEqual({
      allowed: false,
      remainingBytes: 50,
    });
  });

  it("lets unknown-length uploads start only while budget remains", () => {
    expect(quotaDecision({ usedBytes: 99, incomingBytes: null, quotaBytes: 100 }).allowed).toBe(true);
    expect(quotaDecision({ usedBytes: 100, incomingBytes: null, quotaBytes: 100 }).allowed).toBe(false);
    expect(quotaDecision({ usedBytes: 150, incomingBytes: null, quotaBytes: 100 }).remainingBytes).toBe(0);
  });
});

describe("scrub honesty", () => {
  it("splits requested shas into verified and missing by what is actually on disk", () => {
    const onDisk = new Set([SHA_A]);
    const other = "b".repeat(64);
    expect(computeScrubReport([SHA_A, other], onDisk)).toEqual({ verified: [SHA_A], missing: [other] });
  });

  it("drops invalid shas and tolerates a non-array", () => {
    expect(computeScrubReport(["nope", null], new Set())).toEqual({ verified: [], missing: [] });
    expect(computeScrubReport(undefined, new Set())).toEqual({ verified: [], missing: [] });
  });
});

describe("CLI flags", () => {
  it("parses the documented flags with defaults", () => {
    const args = parseArgs(["--setup", "--cloud", "https://team.example.com/", "--name", "pi-shop", "--quota-gb", "40"]);
    expect(args.setup).toBe(true);
    expect(args.cloud).toBe("https://team.example.com");
    expect(args.name).toBe("pi-shop");
    expect(args.quotaGb).toBe(40);
    expect(args.port).toBe(DEFAULT_PORT);
    expect(DEFAULT_QUOTA_GB).toBeGreaterThan(0);
  });

  it("rejects unknown flags, missing values, and bad numbers instead of guessing", () => {
    expect(() => parseArgs(["--quota"])).toThrow(/Unknown flag/);
    expect(() => parseArgs(["--cloud"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--port", "99999"])).toThrow(/--port/);
    expect(() => parseArgs(["--quota-gb", "-3"])).toThrow(/--quota-gb/);
  });
});

describe("formatting and LAN hints", () => {
  it("formats byte counts for humans and admits unknowns", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 ** 3)).toBe("20.0 GB");
    expect(formatBytes(-1)).toBe("unknown");
  });

  it("builds LAN URLs only from external IPv4 interfaces", () => {
    const urls = lanUrlsFor(
      {
        lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
        eth0: [
          { family: "IPv4", address: "192.168.1.20", internal: false },
          { family: "IPv6", address: "fe80::1", internal: false },
        ],
      },
      8788,
    );
    expect(urls).toEqual(["http://192.168.1.20:8788"]);
  });
});
