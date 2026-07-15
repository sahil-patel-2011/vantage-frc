import { buildStrategyPlaybook, predictMatch, runWhatIf } from "@vantage/prediction-strategy";
import { reviewFrcCode } from "@vantage/agent";

/** Deterministic fixtures mirrored from the in-app Strategy and Code demo modules. */
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

export const codeSample = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

export const codeFixture = reviewFrcCode({
  path: "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
  content: codeSample,
});

export const cadFixture = {
  title: "Serviceable intake guard",
  brief:
    "Frame perimeter clear · existing 10-32 mounts · inspect interference before export",
  steps: [
    { id: "01", label: "Requirements + assumptions", state: "Confirmed" as const },
    { id: "02", label: "Reviewed action plan", state: "Approval" as const },
    { id: "03", label: "Geometry + topology checkpoint", state: "Queued" as const },
    { id: "04", label: "Render / BOM artifact", state: "Queued" as const },
  ],
  connectors: [
    { name: "Onshape hosted", status: "Setup required" as const },
    { name: "Fusion local relay", status: "Setup required" as const },
  ],
};
