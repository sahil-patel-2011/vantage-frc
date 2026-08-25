import { describe, expect, it } from "vitest";
import { RAW_EVENT_RETENTION_DAYS, retentionCutoff } from "./retention";

describe("raw event retention", () => {
  // The privacy policy states 180 days in words. This is the same number in
  // code; if one moves without the other, the policy becomes a false statement.
  it("is the 180 days the privacy policy promises", () => {
    expect(RAW_EVENT_RETENTION_DAYS).toBe(180);
  });

  it("puts the cutoff exactly one window behind now", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-02-25T12:00:00.000Z");
  });

  it("accepts a shorter window for a team that wants one", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-07-25T00:00:00.000Z");
  });

  it("falls back to the policy window rather than deleting everything", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    // A zero or negative window would set the cutoff at or after "now" and
    // purge live data, so it is refused in favour of the documented default.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(retentionCutoff(now, bad).toISOString()).toBe(retentionCutoff(now).toISOString());
    }
  });
});
