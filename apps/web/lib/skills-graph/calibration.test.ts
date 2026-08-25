import { describe, expect, it } from "vitest";
import {
  buildCalibrationSignals,
  CALIBRATION_PROPOSAL_MIN_SCORED,
  type CalibrationRow,
} from "./calibration";

const row = (over: Partial<CalibrationRow>): CalibrationRow => ({
  userId: "u1",
  userName: "Nova",
  surface: "gearbox",
  scored: 0,
  spotOn: 0,
  close: 0,
  off: 0,
  skipped: 0,
  lastCallAt: "2026-03-01T00:00:00.000Z",
  ...over,
});

describe("buildCalibrationSignals", () => {
  it("never proposes below the minimum graded sample, and says so", () => {
    const [signal] = buildCalibrationSignals([
      row({ scored: CALIBRATION_PROPOSAL_MIN_SCORED - 1, spotOn: CALIBRATION_PROPOSAL_MIN_SCORED - 1 }),
    ]);
    expect(signal!.proposal).toBeNull();
    expect(signal!.note).toContain("Not enough graded calls yet");
  });

  it("proposes (never writes) a skills entry above both thresholds", () => {
    const [signal] = buildCalibrationSignals([row({ scored: 6, spotOn: 5, close: 1, off: 0 })]);
    expect(signal!.accuracy).toBe(0.92);
    expect(signal!.proposal).not.toBeNull();
    expect(signal!.proposal!.skillCategory).toBe("mechanical_design");
    expect(signal!.proposal!.proficiency).toBe("proficient");
    expect(signal!.proposal!.evidenceNote).toContain("countersigned by a mentor");
  });

  it("keeps a large-but-inaccurate sample as evidence only", () => {
    const [signal] = buildCalibrationSignals([row({ scored: 8, spotOn: 1, close: 2, off: 5 })]);
    expect(signal!.accuracy).toBe(0.25);
    expect(signal!.proposal).toBeNull();
    expect(signal!.note).toContain("evidence only");
  });

  it("maps each surface to its skill category and null accuracy when nothing is graded", () => {
    const signals = buildCalibrationSignals([
      row({ surface: "power_budget", skipped: 3 }),
      row({ surface: "shooter_table", scored: 1, spotOn: 1 }),
    ]);
    const power = signals.find((s) => s.surface === "power_budget")!;
    const shooter = signals.find((s) => s.surface === "shooter_table")!;
    expect(power.skillCategory).toBe("electrical");
    expect(power.accuracy).toBeNull();
    expect(shooter.skillCategory).toBe("shooter");
  });

  it("drops unknown surfaces instead of guessing and sorts proposals first", () => {
    const signals = buildCalibrationSignals([
      row({ surface: "cad", scored: 10, spotOn: 10 }),
      row({ userId: "thin", scored: 2, spotOn: 2, lastCallAt: "2026-03-05T00:00:00.000Z" }),
      row({ userId: "strong", scored: 7, spotOn: 7, lastCallAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.userId).toBe("strong");
    expect(signals[1]!.userId).toBe("thin");
  });
});
