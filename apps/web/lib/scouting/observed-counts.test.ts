import { describe, expect, it } from "vitest";
import { robotMatchesScouted, watchedSummary } from "./observed-counts";

const report = (matchKey?: string) => ({ payload: {}, confidence: "normal" as const, matchKey });

describe("robotMatchesScouted", () => {
  it("counts each team in each match once, however many scouts watched", () => {
    const robots = [
      { teamKey: "frc1", reports: [report("2025x_qm1"), report("2025x_qm1"), report("2025x_qm4")] },
      { teamKey: "frc2", reports: [report("2025x_qm1"), report()] },
    ];
    expect(robotMatchesScouted(robots)).toBe(3);
    expect(watchedSummary(robots)).toBe("2 robots · 3 matches scouted");
  });

  it("uses singular words for one", () => {
    expect(watchedSummary([{ teamKey: "frc1", reports: [report("2025x_qm1")] }])).toBe("1 robot · 1 match scouted");
  });
});
