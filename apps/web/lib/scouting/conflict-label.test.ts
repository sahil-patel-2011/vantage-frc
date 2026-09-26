import { describe, expect, it } from "vitest";
import { conflictFieldLabel, conflictScoutName, conflictTitle, conflictValueLabel } from "./conflict-label";

describe("conflict card words", () => {
  it("names the match and robot plainly", () => {
    expect(conflictTitle("2026gacmp_qm7", "frc3310")).toBe("Qual 7 · 3310");
    expect(conflictTitle("2026gacmp_sf2m1", "frc118")).toBe("Semi 2-1 · 118");
  });

  it("takes the field label from the form, else spells the key out", () => {
    expect(conflictFieldLabel("autoPoints", [{ key: "autoPoints", label: "Auto points" }])).toBe("Auto points");
    expect(conflictFieldLabel("endgame_state", [])).toBe("Endgame state");
    expect(conflictFieldLabel("teleopCycles", null)).toBe("Teleop cycles");
  });

  it("never shows 'Unknown scout'", () => {
    expect(conflictScoutName("Unknown scout")).toBe("Team scout");
    expect(conflictScoutName("")).toBe("Team scout");
    expect(conflictScoutName("Riley")).toBe("Riley");
  });

  it("reads values like the form does", () => {
    expect(conflictValueLabel(4)).toBe("4");
    expect(conflictValueLabel("climb")).toBe("Climb");
    expect(conflictValueLabel(true)).toBe("Yes");
    expect(conflictValueLabel(null)).toBe("Left blank");
  });
});
