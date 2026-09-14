import { describe, expect, it } from "vitest";
import { formatReportClock, scoutReportFromPayload } from "./scout-report";

describe("scoutReportFromPayload", () => {
  it("turns real payload fields into stats and skips empty ones", () => {
    const report = scoutReportFromPayload({
      autoCoral: 4,
      climb: "deep",
      notes: "  ",
      defense: true,
    });
    expect(report.stats.map((stat) => stat.label)).toEqual(["Auto Coral", "Climb", "Defense"]);
    expect(report.stats.find((stat) => stat.key === "defense")?.value).toBe("Yes");
    expect(report.timeline).toEqual([]);
  });

  it("builds a timeline from recorded actions and leaves missing clocks as —", () => {
    const report = scoutReportFromPayload({
      score: 12,
      actions: [
        { t: 18, action: "L4" },
        { action: "Climb" },
        { tSeconds: 8, label: "Mobility" },
      ],
    });
    expect(report.timeline.map((event) => event.label)).toEqual(["Mobility", "L4", "Climb"]);
    expect(formatReportClock(report.timeline[0]?.atSeconds ?? null)).toBe("0:08");
    expect(formatReportClock(report.timeline[2]?.atSeconds ?? null)).toBe("—");
  });

  it("returns empty instead of inventing a report", () => {
    expect(scoutReportFromPayload(null)).toEqual({ stats: [], timeline: [] });
    expect(scoutReportFromPayload({})).toEqual({ stats: [], timeline: [] });
  });
});
