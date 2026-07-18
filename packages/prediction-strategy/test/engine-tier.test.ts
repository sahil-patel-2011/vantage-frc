import { describe, expect, it } from "vitest";
import {
  PLAN_TO_ENGINE_ID,
  predictMatch,
  seasonWeight,
  selectStrategyEngine,
  signalsFromEventMetrics,
  type EventMetricRow,
} from "../src";

describe("plan → strategy engine selection", () => {
  it("maps Free/BYOK and Access to baseline weighted-current-v1", () => {
    expect(selectStrategyEngine("free").engineId).toBe("weighted-current-v1");
    expect(selectStrategyEngine("access").engineId).toBe("weighted-current-v1");
    expect(selectStrategyEngine(null).engineId).toBe("weighted-current-v1");
    expect(selectStrategyEngine(undefined).engineId).toBe("weighted-current-v1");
    expect(selectStrategyEngine("FREE").tier).toBe("baseline");
  });

  it("maps Individual Pro / Team Pro (and trial) to strategy-engine-v2", () => {
    expect(selectStrategyEngine("individual_pro").engineId).toBe("strategy-engine-v2");
    expect(selectStrategyEngine("team_pro").engineId).toBe("strategy-engine-v2");
    expect(selectStrategyEngine("team_trial").engineId).toBe("strategy-engine-v2");
    expect(selectStrategyEngine("team_pro").depth).toBe(2);
    expect(selectStrategyEngine("individual_pro").thisSeasonOnly).toBe(true);
  });

  it("maps Individual Max / Team Max to strategy-engine-max-v1", () => {
    expect(selectStrategyEngine("individual_max").engineId).toBe("strategy-engine-max-v1");
    expect(selectStrategyEngine("team_max").engineId).toBe("strategy-engine-max-v1");
    expect(selectStrategyEngine("team_max").depth).toBe(3);
    expect(selectStrategyEngine("individual_max").includeEpaDrift).toBe(true);
    expect(selectStrategyEngine("team_max").extraReasoningSteps).toBe(true);
    expect(selectStrategyEngine("team_max").fullLeaveOneOutFactors).toBe(true);
  });

  it("exposes a stable PLAN_TO_ENGINE_ID map", () => {
    expect(PLAN_TO_ENGINE_ID.free).toBe("weighted-current-v1");
    expect(PLAN_TO_ENGINE_ID.access).toBe("weighted-current-v1");
    expect(PLAN_TO_ENGINE_ID.individual_pro).toBe("strategy-engine-v2");
    expect(PLAN_TO_ENGINE_ID.team_pro).toBe("strategy-engine-v2");
    expect(PLAN_TO_ENGINE_ID.individual_max).toBe("strategy-engine-max-v1");
    expect(PLAN_TO_ENGINE_ID.team_max).toBe("strategy-engine-max-v1");
  });

  it("falls back to baseline for unknown plan codes", () => {
    expect(selectStrategyEngine("not_a_real_plan").engineId).toBe("weighted-current-v1");
  });
});

describe("engine depth behavior", () => {
  const fixtureMetrics: EventMetricRow[] = [
    {
      teamKey: "frc10",
      year: 2026,
      eventKey: "2026miket",
      source: "statbotics",
      epaTotal: 40,
      epaAuto: 8,
      wins: 6,
      losses: 2,
      ties: 0,
    },
    {
      teamKey: "frc11",
      year: 2026,
      eventKey: "2026miket",
      source: "tba",
      epaTotal: 30,
      epaAuto: 6,
      wins: 4,
      losses: 4,
      ties: 0,
    },
    {
      teamKey: "frc12",
      year: 2026,
      eventKey: "2026miket",
      source: "statbotics",
      epaTotal: 28,
      epaAuto: 5,
      wins: 4,
      losses: 4,
      ties: 0,
    },
    {
      teamKey: "frc20",
      year: 2026,
      eventKey: "2026miket",
      source: "statbotics",
      epaTotal: 22,
      epaAuto: 4,
      wins: 3,
      losses: 5,
      ties: 0,
    },
    {
      teamKey: "frc21",
      year: 2026,
      eventKey: "2026miket",
      source: "tba",
      epaTotal: 20,
      epaAuto: 3,
      wins: 2,
      losses: 6,
      ties: 0,
    },
    {
      teamKey: "frc22",
      year: 2026,
      eventKey: "2026miket",
      source: "statbotics",
      epaTotal: 18,
      epaAuto: 3,
      wins: 2,
      losses: 6,
      ties: 0,
    },
  ];

  const seasons = [
    ...signalsFromEventMetrics(fixtureMetrics),
    // Prior-year signal — baseline may blend; Pro/Max this-season must ignore.
    {
      teamKey: "frc20",
      year: 2025,
      matches: 20,
      epa: 55,
      autoEpa: 12,
      source: "statbotics",
      eventKey: "2025miket",
    },
  ];

  const baseInput = {
    matchKey: "2026miket_qm1",
    currentYear: 2026,
    red: ["frc10", "frc11", "frc12"],
    blue: ["frc20", "frc21", "frc22"],
    seasons,
    operations: [
      {
        teamKey: "frc20",
        scoutSample: 8,
        reliability: 70,
        foulRate: 1.2,
        qualityWeight: 0.8,
        teleopCapability: 0.5,
      },
      {
        teamKey: "frc10",
        scoutSample: 5,
        reliability: 95,
        foulRate: 0.1,
        qualityWeight: 1,
        autoCapability: 0.7,
      },
    ],
  };

  it("baseline keeps multi-season weights", () => {
    expect(seasonWeight(2026, 2025, "recency")).toBe(0.55);
    expect(seasonWeight(2026, 2025, "this-season")).toBe(0);
    const prediction = predictMatch({ ...baseInput, engineId: "weighted-current-v1" });
    expect(prediction.modelVersion).toBe("weighted-current-v1");
    expect(prediction.keyFactors.some((f) => f.name === "this-season rules")).toBe(false);
    expect(prediction.reasoningSteps).toBeUndefined();
  });

  it("v2 uses this-season rules and TBA+scout trust blend", () => {
    const prediction = predictMatch({ ...baseInput, engineId: "strategy-engine-v2" });
    expect(prediction.modelVersion).toBe("strategy-engine-v2");
    expect(prediction.keyFactors.map((f) => f.name)).toContain("this-season rules");
    expect(prediction.keyFactors.map((f) => f.name)).toContain("TBA+scout trust blend");
    expect(prediction.caveats.some((c) => /This-season rules only/i.test(c))).toBe(true);
  });

  it("max adds reasoning steps and deeper factors without inventing DEMO stats", () => {
    const seasonsWithYear = [
      ...seasons,
      {
        teamKey: "frc10",
        year: 2026,
        matches: 40,
        epa: 32,
        autoEpa: 6,
        source: "statbotics",
      },
    ];
    const prediction = predictMatch({
      ...baseInput,
      seasons: seasonsWithYear,
      engineId: "strategy-engine-max-v1",
    });
    expect(prediction.modelVersion).toBe("strategy-engine-max-v1");
    expect(prediction.reasoningSteps?.length).toBeGreaterThanOrEqual(4);
    expect(prediction.reasoningSteps?.[0]?.detail).toMatch(/never invented/i);
    expect(prediction.keyFactors.some((f) => f.name.startsWith("EPA drift"))).toBe(true);
    expect(prediction.caveats.every((c) => !/DEMO/i.test(c) || /without inventing DEMO/i.test(c))).toBe(
      true,
    );
  });
});
