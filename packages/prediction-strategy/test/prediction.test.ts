import { describe, expect, it } from "vitest";
import {
  buildAllianceMatchup,
  buildStrategyPlaybook,
  opponentTendencies,
  pickListHintsForAlliance,
  predictMatch,
  predictionAccuracy,
  runWhatIf,
  seasonWeight,
  signalsFromEventMetrics,
  type EventMetricRow,
} from "../src";

/** TBA/Statbotics-shaped fixture — mirrors Neon `team_event_metrics` + worker mappers. */
const fixtureMetrics: EventMetricRow[] = [
  {
    teamKey: "frc2337",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 42.5,
    epaAuto: 8.5,
    epaEndgame: 10,
    wins: 8,
    losses: 2,
    ties: 0,
    rank: 2,
  },
  {
    teamKey: "frc1",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 28,
    epaAuto: 5,
    epaEndgame: 6,
    wins: 4,
    losses: 4,
    ties: 0,
    rank: 18,
  },
  {
    teamKey: "frc2",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 31,
    epaAuto: 6,
    epaEndgame: 7,
    wins: 5,
    losses: 3,
    ties: 0,
    rank: 12,
  },
  {
    teamKey: "frc3",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 22,
    epaAuto: 4,
    epaEndgame: 5,
    wins: 3,
    losses: 5,
    ties: 0,
    rank: 28,
  },
  {
    teamKey: "frc4",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 19,
    epaAuto: 3,
    epaEndgame: 4,
    wins: 2,
    losses: 6,
    ties: 0,
    rank: 36,
  },
  {
    teamKey: "frc5",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 24,
    epaAuto: 5,
    epaEndgame: 5,
    wins: 4,
    losses: 4,
    ties: 0,
    rank: 22,
  },
  // Missing EPA must never become a fake demo default
  {
    teamKey: "frc9999",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: null,
  },
];

const seasons = signalsFromEventMetrics(fixtureMetrics);

const prediction = predictMatch({
  matchKey: "2026miket_qm1",
  currentYear: 2026,
  eventLabel: "Kettering University Event #1",
  red: ["frc2337", "frc2", "frc3"],
  blue: ["frc1", "frc4", "frc5"],
  seasons,
  operations: [
    { teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 },
    { teamKey: "frc2337", scoutSample: 4, reliability: 94, foulRate: 0.2 },
  ],
});

describe("weighted prediction", () => {
  it("weights current data above the prior two seasons", () => {
    expect([seasonWeight(2026, 2026), seasonWeight(2026, 2025), seasonWeight(2026, 2024)]).toEqual([
      1, 0.55, 0.3,
    ]);
    expect(seasonWeight(2026, 2023)).toBe(0);
  });

  it("returns calibrated bounds, factors, and deterministic probabilities", () => {
    expect(prediction.pRed).toBeGreaterThan(0.5);
    expect(prediction.confidenceLow).toBeLessThan(prediction.pRed);
    expect(prediction.confidenceHigh).toBeGreaterThan(prediction.pRed);
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("weighted scoring");
    expect(prediction.keyFactors[0]?.evidence).toMatch(/statbotics|tba|2026miket/);
    expect(prediction.caveats.some((item) => item.includes("MODEL"))).toBe(true);
  });

  it("blends scout foul exposure when org observations exist", () => {
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("foul exposure");
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("scout reliability");
  });
});

describe("TBA-shaped signal builders", () => {
  it("maps fixture metrics without inventing EPA for missing rows", () => {
    expect(seasons.find((row) => row.teamKey === "frc9999")).toBeUndefined();
    expect(seasons.find((row) => row.teamKey === "frc2337")?.epa).toBe(42.5);
    expect(seasons.find((row) => row.teamKey === "frc2337")?.matches).toBe(10);
    expect(seasons.find((row) => row.teamKey === "frc2337")?.source).toBe("statbotics");
  });

  it("builds alliance matchup considerations from metrics + scout", () => {
    const matchup = buildAllianceMatchup({
      red: ["frc2337", "frc2", "frc3"],
      blue: ["frc1", "frc4", "frc5"],
      metrics: fixtureMetrics,
      operations: [{ teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 }],
    });
    expect(matchup.redTotalEpa).toBeGreaterThan(matchup.blueTotalEpa!);
    expect(matchup.considerations.some((item) => /Alliance EPA/.test(item))).toBe(true);
    expect(matchup.considerations.some((item) => /foul rate/i.test(item))).toBe(true);
  });

  it("derives opponent tendencies with cited evidence", () => {
    const tendencies = opponentTendencies({
      opponentKeys: ["frc1", "frc4"],
      metrics: fixtureMetrics,
      operations: [{ teamKey: "frc1", scoutSample: 6, reliability: 60, foulRate: 2 }],
    });
    expect(tendencies[0]?.labels).toContain("foul-prone");
    expect(tendencies[0]?.evidence.join(" ")).toMatch(/frc1/);
  });

  it("surfaces pick-list ranks only for alliance teams present on lists", () => {
    const hints = pickListHintsForAlliance(
      ["frc2337", "frc1"],
      [
        { teamKey: "frc2337", listName: "First picks", rank: 1, tier: "A", notes: "Anchor" },
        { teamKey: "frc99", listName: "First picks", rank: 2 },
        { teamKey: "frc1", listName: "Defense", rank: 3, notes: "Foul risk" },
      ],
    );
    expect(hints).toHaveLength(2);
    expect(hints[0]?.teamKey).toBe("frc2337");
  });
});

describe("prediction to strategy", () => {
  it("shows what-if assumptions without rewriting the baseline", () => {
    const scenario = runWhatIf(prediction, [
      { alliance: "blue", label: "successful endgame", pointDelta: 12 },
    ]);
    expect(scenario.pRed).toBeLessThan(prediction.pRed);
    expect(scenario.assumptions[0]?.label).toBe("successful endgame");
  });

  it("builds an actionable playbook and post-match debrief", () => {
    const playbook = buildStrategyPlaybook({
      prediction,
      ourAlliance: "red",
      opponentFoulRisk: "high",
    });
    expect(playbook.priorities.length).toBeGreaterThanOrEqual(3);
    expect(playbook.debriefPrompts).toHaveLength(3);
    expect(playbook.provenance.length).toBeGreaterThan(0);
  });

  it("tracks classification and probability accuracy", () => {
    expect(
      predictionAccuracy([
        { pRed: 0.8, winner: "red" },
        { pRed: 0.4, winner: "blue" },
      ]),
    ).toEqual({ count: 2, accuracy: 1, brierScore: 0.1 });
  });
});
