import { describe, expect, it } from "vitest";
import { buildEpaDriftCallouts, pickModeSources } from "./pick-assist";

describe("pick-assist", () => {
  it("flags divergent last-3 alliance share vs season EPA", () => {
    const recent = new Map<string, number[]>([["frc2337", [78, 82, 80]]]);
    const callouts = buildEpaDriftCallouts([{ teamKey: "frc2337", epa: 60 }], recent);
    expect(callouts).toHaveLength(1);
    expect(callouts[0]?.divergent).toBe(true);
    expect(callouts[0]?.label).toMatch(/EPA may lag/);
  });

  it("skips teams without EPA or enough recent scores", () => {
    const recent = new Map<string, number[]>([
      ["frc1", [70]],
      ["frc2", [70, 72, 74]],
    ]);
    const callouts = buildEpaDriftCallouts(
      [
        { teamKey: "frc1", epa: 60 },
        { teamKey: "frc2", epa: null },
        { teamKey: "frc3", epa: 55 },
      ],
      recent,
    );
    expect(callouts).toEqual([]);
  });

  it("tags low-data sources without dropping TBA/Statbotics labels", () => {
    expect(pickModeSources("low_data_tba", ["statbotics", "tba"])).toEqual([
      "statbotics",
      "tba",
      "low_data_tba",
    ]);
    expect(pickModeSources("full", ["statbotics"])).toEqual(["statbotics"]);
  });
});
