import { describe, expect, it, vi } from "vitest";
import { activityRelativeTime } from "./cad-model";

describe("cad-model", () => {
  it("returns an empty string for a non-date", () => {
    expect(activityRelativeTime("not-a-date")).toBe("");
  });

  it("prints minutes, hours, and days from a real timestamp", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
      expect(activityRelativeTime("2026-09-10T11:59:50.000Z")).toBe("just now");
      expect(activityRelativeTime("2026-09-10T11:45:00.000Z")).toBe("15m ago");
      expect(activityRelativeTime("2026-09-10T09:00:00.000Z")).toBe("3h ago");
      expect(activityRelativeTime("2026-09-08T12:00:00.000Z")).toBe("2d ago");
    } finally {
      vi.useRealTimers();
    }
  });
});
