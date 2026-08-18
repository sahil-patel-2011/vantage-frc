import { describe, expect, it } from "vitest";
import { parseTuningAction, summarizeTuning, validateConstant, currentLimitTuningCue, CURRENT_LIMIT_TUNING_CUE } from "./tuning";

describe("validateConstant", () => {
  it("requires a name and a value", () => {
    expect(validateConstant({ value: "0.373", category: "encoder_offset" }).ok).toBe(false);
    expect(validateConstant({ name: "FL offset", category: "encoder_offset" }).ok).toBe(false);
  });
  it("rejects an invalid category", () => {
    expect(validateConstant({ name: "FL offset", value: "0.373", category: "vibes" }).ok).toBe(false);
  });
  it("preserves the value as text (radians, arrays, etc.)", () => {
    const result = validateConstant({ name: "Drive kP", value: "[0.1, 0.0, 0.05]", category: "pid", unit: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe("[0.1, 0.0, 0.05]");
  });
});

describe("summarizeTuning", () => {
  it("counts by category and distinct subsystem", () => {
    const summary = summarizeTuning([
      { subsystem: "Swerve", category: "encoder_offset" },
      { subsystem: "Swerve", category: "encoder_offset" },
      { subsystem: "Arm", category: "pid" },
      { subsystem: "", category: "vision" },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byCategory.encoder_offset).toBe(2);
    expect(summary.byCategory.pid).toBe(1);
    expect(summary.subsystems).toBe(3); // Swerve, Arm, General
  });

  it("cues missing current-limit constants only when PID/encoder rows exist", () => {
    expect(currentLimitTuningCue([])).toBeNull();
    expect(currentLimitTuningCue([{ category: "vision", name: "LL yaw", notes: "" }])).toBeNull();
    expect(
      currentLimitTuningCue([{ category: "pid", name: "Drive kP", notes: "" }]),
    ).toBe(CURRENT_LIMIT_TUNING_CUE);
    expect(
      currentLimitTuningCue([
        { category: "pid", name: "Drive kP", notes: "" },
        { category: "limit", name: "Drive supply current limit", notes: "40 A" },
      ]),
    ).toBeNull();
  });
});

describe("parseTuningAction", () => {
  it("parses save_constant with a season year", () => {
    const action = parseTuningAction({ action: "save_constant", orgId: "o1", seasonYear: 2026, name: "FL offset", value: "0.373", category: "encoder_offset" });
    expect(action.action).toBe("save_constant");
    expect(action).toMatchObject({ name: "FL offset", value: "0.373" });
  });
  it("rejects save_constant without season year", () => {
    expect(() => parseTuningAction({ action: "save_constant", orgId: "o1", name: "x", value: "1", category: "other" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseTuningAction({ action: "detune", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
