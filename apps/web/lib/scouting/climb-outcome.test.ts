import { describe, expect, it } from "vitest";
import { climbOutcome, climbSucceeded, combineClimbOutcomes } from "./climb-outcome";

describe("observed climb outcomes", () => {
  it.each([undefined, null, "", "could_not_see", "unknown", "not_recorded", "custom answer", NaN, Infinity, -1, {}])("keeps unseen or unrecognized outcome %j unknown", value => {
    expect(climbOutcome(value)).toBe("unseen");
    expect(climbSucceeded(value)).toBeNull();
  });
  it("distinguishes intent only when it was explicitly recorded", () => {
    expect(climbOutcome("none")).toBe("no_success");
    expect(climbOutcome(false)).toBe("no_success");
    expect(climbOutcome("park")).toBe("no_success");
    expect(climbOutcome("not attempted")).toBe("not_attempted");
    expect(climbOutcome("attempted_failed")).toBe("failed");
    expect(climbOutcome("fell")).toBe("failed");
    expect(climbOutcome(" L3 ")).toBe("successful");
  });
  it("retains unknown success ties and does not invent intent from conflicting negatives", () => {
    expect(combineClimbOutcomes(["successful", "failed"])).toBe("unseen");
    expect(combineClimbOutcomes(["successful", "successful", "unseen"])).toBe("successful");
    expect(combineClimbOutcomes(["failed", "not_attempted"])).toBe("no_success");
    expect(combineClimbOutcomes(["failed", "failed", "unseen"])).toBe("failed");
  });
});
