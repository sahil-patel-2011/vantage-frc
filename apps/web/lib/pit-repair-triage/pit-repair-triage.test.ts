import { describe, expect, it } from "vitest";
import { CAN_BUS_DROPOUT_CUE, MAIN_BREAKER_TRIP_CUE, canBusDropoutCue, mainBreakerTripCue, needsReinspectionBeforeQueue, reinspectionCue } from ".";

describe("I104 reinspection cue (CD pit changes)", () => {
  it("cues open and staged fix/swap — never monitor, never a resolved report", () => {
    expect(needsReinspectionBeforeQueue({ decision: "fix", status: "open" })).toBe(true);
    expect(needsReinspectionBeforeQueue({ decision: "swap", status: "staged" })).toBe(true);
    expect(needsReinspectionBeforeQueue({ decision: "monitor", status: "open" })).toBe(false);
    expect(needsReinspectionBeforeQueue({ decision: "fix", status: "resolved" })).toBe(false);
  });

  it("does not invent that a resolved repair skipped inspection", () => {
    expect(reinspectionCue({ decision: "swap", status: "resolved", subsystemName: "Climber" })).toBeNull();
    const cue = reinspectionCue({ decision: "fix", status: "open", subsystemName: "Elevator" });
    expect(cue).toMatch(/I104/);
    expect(cue).toContain("Elevator");
    expect(cue?.toLowerCase()).not.toContain("demo");
  });
});

describe("main breaker trip cue", () => {
  it("cues open/staged reports that mention a tripped main breaker — never a resolved row", () => {
    expect(
      mainBreakerTripCue({ title: "Intake jam", symptomNote: "roller stall", status: "open" }),
    ).toBeNull();
    expect(
      mainBreakerTripCue({
        title: "Main breaker tripped",
        symptomNote: "Brownout then dead",
        status: "open",
      }),
    ).toBe(MAIN_BREAKER_TRIP_CUE);
    expect(
      mainBreakerTripCue({
        title: "Power",
        symptomNote: "breaker trip during climb",
        status: "staged",
      }),
    ).toBe(MAIN_BREAKER_TRIP_CUE);
    expect(
      mainBreakerTripCue({
        title: "Main breaker tripped",
        status: "resolved",
      }),
    ).toBeNull();
  });
});

describe("CAN bus dropout cue", () => {
  it("cues open CAN-dropout reports to check 60Ω termination — never a resolved row", () => {
    expect(canBusDropoutCue({ title: "Intake jam", symptomNote: "roller stall", status: "open" })).toBeNull();
    expect(
      canBusDropoutCue({
        title: "CAN bus dropouts",
        symptomNote: "devices blink then vanish",
        status: "open",
      }),
    ).toBe(CAN_BUS_DROPOUT_CUE);
    expect(CAN_BUS_DROPOUT_CUE.toLowerCase()).toMatch(/60/);
    expect(CAN_BUS_DROPOUT_CUE.toLowerCase()).not.toContain("demo");
    expect(
      canBusDropoutCue({
        title: "CAN timeout on swerve",
        status: "resolved",
      }),
    ).toBeNull();
  });
});
