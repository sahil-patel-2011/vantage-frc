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
    expect(report.notes).toEqual([]);
    expect(report.timeline).toEqual([]);
  });

  it("keeps notes and derived rates off the raw stats list", () => {
    const report = scoutReportFromPayload({
      auto_fuel: 3,
      teleop_fuel: 9,
      fuel_passed: 4,
      notes: "Long range from the trench",
      scoring_time: 10,
    });
    expect(report.notes).toEqual(["Long range from the trench"]);
    expect(report.stats.map((stat) => stat.key)).toEqual(["auto_fuel", "fuel_passed", "scoring_time", "teleop_fuel"]);
    expect(report.rates.find((rate) => rate.id === "estimatedTotalFuelScored")?.value).toBe("12");
    expect(report.rates.find((rate) => rate.id === "totalFuelFed")?.value).toBe("4");
    expect(report.rates.find((rate) => rate.id === "scoringRate")?.value).toBe("1.2");
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
    expect(scoutReportFromPayload(null)).toEqual({ stats: [], notes: [], rates: [], timeline: [] });
    expect(scoutReportFromPayload({})).toEqual({ stats: [], notes: [], rates: [], timeline: [] });
  });
});
