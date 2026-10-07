import { describe, expect, it } from "vitest";
import { rebuiltShiftAt } from "./match-clock";

describe("REBUILT alliance shift guidance", () => {
  it.each([
    [0, "Auto", "active", 20], [19999, "Auto", "active", 1], [20000, "Scoring pause", "unknown", 3],
    [23000, "Transition shift", "active", 10], [33000, "Alliance shift 1", "inactive", 25],
    [58000, "Alliance shift 2", "active", 25], [83000, "Alliance shift 3", "inactive", 25],
    [108000, "Alliance shift 4", "active", 25], [133000, "Endgame", "active", 30], [163000, "Match over", "unknown", 0],
  ])("checks the boundary at %s ms", (elapsed, label, hub, secondsLeft) => {
    expect(rebuiltShiftAt(elapsed as number, "red", "red")).toEqual({ label, hub, secondsLeft });
  });
  it("alternates the opposite alliance and never guesses an autonomous tie", () => {
    expect(rebuiltShiftAt(33000, "blue", "red").hub).toBe("active");
    expect(rebuiltShiftAt(58000, "blue", "red").hub).toBe("inactive");
    expect(rebuiltShiftAt(33000, "red").hub).toBe("unknown");
    expect(rebuiltShiftAt(33000, null, "blue").hub).toBe("unknown");
  });
});
