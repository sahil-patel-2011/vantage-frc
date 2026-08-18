import { describe, expect, it } from "vitest";
import { needsReinspectionBeforeQueue, reinspectionCue } from ".";

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
