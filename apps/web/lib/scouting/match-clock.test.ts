import { describe, expect, it } from "vitest";
import { clockLabel, liveClockReadout, phaseAnchors, phaseAt, phaseRemainingSeconds, rebuiltShiftAt, timingForSeason } from "./match-clock";

describe("match clock", () => {
  it("uses official 2026 timing with a scoring pause and a 30-second endgame", () => {
    const timing = timingForSeason(2026);
    expect(phaseAt(19_999,timing)).toBe("auto");
    expect(phaseAt(20_000,timing)).toBe("transition");
    expect(phaseRemainingSeconds(20_000,timing)).toBe(3);
    expect(phaseAt(23_000,timing)).toBe("teleop");
    expect(phaseAt(132_999,timing)).toBe("teleop");
    expect(phaseAt(133_000,timing)).toBe("endgame");
    expect(phaseRemainingSeconds(133_000,timing)).toBe(30);
    expect(phaseAt(163_000,timing)).toBe("done");
  });
  it("walks pre, auto, teleop, endgame, done on standard FRC timing", () => {
    expect(phaseAt(null)).toBe("pre");
    expect(phaseAt(0)).toBe("auto");
    expect(phaseAt(14_999)).toBe("auto");
    expect(phaseAt(15_000)).toBe("teleop");
    expect(phaseAt(129_999)).toBe("teleop");
    expect(phaseAt(130_000)).toBe("endgame");
    expect(phaseAt(150_000)).toBe("done");
  });

  it("shows one countdown in the live header: the 2026 shift it names, with match time left beside it", () => {
    const timing = timingForSeason(2026);
    // At 24.5 s the header said "109s" (the endgame) under "Transition shift", which ends at 33 s.
    const shift = rebuiltShiftAt(24_555, "red", "unknown");
    expect(liveClockReadout(24_555, timing, shift)).toEqual({ big: "9s", label: "Transition shift · hub active", left: "2:19 left" });
    expect(liveClockReadout(5_000, timing, rebuiltShiftAt(5_000, "red"))).toEqual({ big: "15s", label: "Auto · hub active", left: "2:38 left" });
    // Done says the match is over, not how long ago it started.
    expect(liveClockReadout(170_000, timing, rebuiltShiftAt(170_000, "red"))).toEqual({ big: "Done", label: "Match over", left: null });
    // Other seasons count down the phase they name.
    expect(liveClockReadout(5_000)).toEqual({ big: "10s", label: "Auto", left: "2:25 left" });
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
