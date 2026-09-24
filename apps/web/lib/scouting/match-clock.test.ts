import { describe, expect, it } from "vitest";
import { clockLabel, phaseAnchors, phaseAt, phaseRemainingSeconds } from "./match-clock";

describe("match clock", () => {
  it("walks pre, auto, teleop, endgame, done on standard FRC timing", () => {
    expect(phaseAt(null)).toBe("pre");
    expect(phaseAt(0)).toBe("auto");
    expect(phaseAt(14_999)).toBe("auto");
    expect(phaseAt(15_000)).toBe("teleop");
    expect(phaseAt(129_999)).toBe("teleop");
    expect(phaseAt(130_000)).toBe("endgame");
    expect(phaseAt(150_000)).toBe("done");
  });

  it("counts down to the end of the phase and labels the clock", () => {
    expect(phaseRemainingSeconds(5_000)).toBe(10);
    expect(phaseRemainingSeconds(140_500)).toBe(10);
    expect(clockLabel(75_400)).toBe("1:15");
  });

  it("finds the part of the form for each phase by key or label", () => {
    const anchors = phaseAnchors([
      { key: "start_pos", label: "Starting position" },
      { key: "auto_points", label: "Auto points" },
      { key: "teleop_cycles", label: "Teleop cycles" },
      { key: "climb", label: "Endgame climb" },
    ]);
    expect(anchors).toEqual({ auto: "auto_points", teleop: "teleop_cycles", endgame: "climb" });
    expect(phaseAnchors([{ key: "notes", label: "Notes" }])).toEqual({});
  });
});
