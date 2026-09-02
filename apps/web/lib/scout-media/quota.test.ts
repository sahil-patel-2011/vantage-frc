import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOUT_MEDIA_MAX_BYTES,
  DEFAULT_SCOUT_MEDIA_MAX_ITEMS,
  formatQuotaBytes,
  normalizeScoutMediaUsage,
  resolveScoutMediaQuota,
  scoutMediaQuotaExceededReason,
  scoutMediaQuotaSummary,
} from "./quota";

describe("resolveScoutMediaQuota", () => {
  it("falls back to defaults when the org has no quota row", () => {
    expect(resolveScoutMediaQuota(null)).toEqual({
      maxItems: DEFAULT_SCOUT_MEDIA_MAX_ITEMS,
      maxBytes: DEFAULT_SCOUT_MEDIA_MAX_BYTES,
    });
    expect(resolveScoutMediaQuota(undefined)).toEqual({
      maxItems: 2000,
      maxBytes: 2147483648,
    });
  });

  it("accepts pg bigint strings and rejects negative / NaN values", () => {
    expect(resolveScoutMediaQuota({ maxItems: "50", maxBytes: "1048576" })).toEqual({
      maxItems: 50,
      maxBytes: 1048576,
    });
    expect(resolveScoutMediaQuota({ maxItems: -1, maxBytes: Number.NaN })).toEqual({
      maxItems: DEFAULT_SCOUT_MEDIA_MAX_ITEMS,
      maxBytes: DEFAULT_SCOUT_MEDIA_MAX_BYTES,
    });
  });

  it("normalizes usage aggregates from count/sum rows", () => {
    expect(normalizeScoutMediaUsage({ items: "12", bytes: "3400" })).toEqual({ items: 12, bytes: 3400 });
    expect(normalizeScoutMediaUsage(null)).toEqual({ items: 0, bytes: 0 });
  });
});

describe("scoutMediaQuotaExceededReason", () => {
  const quota = { maxItems: 3, maxBytes: 1000 };

  it("allows an upload that fits both caps", () => {
    expect(scoutMediaQuotaExceededReason({ items: 2, bytes: 400 }, quota, 500)).toBeNull();
    expect(scoutMediaQuotaExceededReason({ items: 0, bytes: 0 }, quota, 1000)).toBeNull();
  });

  it("blocks when the item count is already at the cap", () => {
    const reason = scoutMediaQuotaExceededReason({ items: 3, bytes: 0 }, quota, 10);
    expect(reason).toMatch(/3-photo limit/);
    expect(reason).toMatch(/Pit photos/);
  });

  it("blocks when the incoming bytes would cross the byte cap", () => {
    const reason = scoutMediaQuotaExceededReason({ items: 1, bytes: 900 }, quota, 101);
    expect(reason).toMatch(/storage limit/);
    expect(scoutMediaQuotaExceededReason({ items: 1, bytes: 900 }, quota, 100)).toBeNull();
  });

  it("treats a bogus incoming size as zero bytes", () => {
    expect(scoutMediaQuotaExceededReason({ items: 0, bytes: 1000 }, quota, Number.NaN)).toBeNull();
    expect(scoutMediaQuotaExceededReason({ items: 0, bytes: 1000 }, quota, 1)).not.toBeNull();
  });
});

describe("quota summary + formatting", () => {
  it("formats bytes at a human scale", () => {
    expect(formatQuotaBytes(512)).toBe("512 B");
    expect(formatQuotaBytes(4096)).toBe("4 KB");
    expect(formatQuotaBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
    expect(formatQuotaBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatQuotaBytes(-5)).toBe("0 B");
  });

  it("reports the larger of the item and byte shares", () => {
    const summary = scoutMediaQuotaSummary({ items: 10, bytes: 500 }, { maxItems: 100, maxBytes: 1000 });
    expect(summary.share).toBeCloseTo(0.5);
    expect(summary.label).toContain("10 / 100 photos");
    const zeroQuota = scoutMediaQuotaSummary({ items: 0, bytes: 0 }, { maxItems: 0, maxBytes: 0 });
    expect(zeroQuota.share).toBe(1);
  });
});
