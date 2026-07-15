import { buildStrategyPlaybook, predictMatch, runWhatIf } from "@vantage/prediction-strategy";

/** Deterministic Strategy fixture for marketing + explicit “Try demo scenario” opt-in only. */
export const strategyFixture = (() => {
  const prediction = predictMatch({
    matchKey: "demo_qm42",
    currentYear: 2026,
    red: ["frc254", "frc1678", "frc4414"],
    blue: ["frc2056", "frc1323", "frc971"],
    seasons: [
      ...["frc254", "frc1678", "frc4414"].map((teamKey, index) => ({
        teamKey,
        year: 2026,
        matches: 12,
        epa: [31, 28, 24][index]!,
        autoEpa: [8, 7, 6][index],
      })),
      ...["frc2056", "frc1323", "frc971"].map((teamKey, index) => ({
        teamKey,
        year: 2026,
        matches: 12,
        epa: [29, 25, 23][index]!,
        autoEpa: [7, 6, 5][index],
      })),
    ],
    operations: [
      { teamKey: "frc254", scoutSample: 10, reliability: 94 },
      { teamKey: "frc971", scoutSample: 8, reliability: 83, foulRate: 1.2 },
    ],
  });
  const scenario = runWhatIf(prediction, [
    { alliance: "red", label: "Protect autonomous route", pointDelta: 4 },
    { alliance: "blue", label: "One practiced defender", pointDelta: -3 },
  ]);
  const playbook = buildStrategyPlaybook({
    prediction,
    ourAlliance: "red",
    opponentFoulRisk: "medium",
  });
  return { prediction, scenario, playbook, ourAlliance: "red" as const };
})();
