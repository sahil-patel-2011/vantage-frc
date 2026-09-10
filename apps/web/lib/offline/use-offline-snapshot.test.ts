import { describe, expect, it } from "vitest";
import { offlineBannerLabel } from "./use-offline-snapshot";

describe("offline banner copy", () => {
  it("names the last snapshot instead of a Retry dead-end", () => {
    expect(offlineBannerLabel(null)).toBe("Offline — showing what was on this device last time.");
    expect(offlineBannerLabel("not-a-date")).toMatch(/last time/);
    const cachedAt = "2026-04-04T14:02:00.000Z";
    const label = offlineBannerLabel(cachedAt, new Date("2026-04-04T18:00:00.000Z"));
    expect(label.startsWith("Offline — showing what you had")).toBe(true);
    expect(label).not.toMatch(/retry/i);
  });
});
