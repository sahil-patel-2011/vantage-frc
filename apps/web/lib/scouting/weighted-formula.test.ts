import { describe, expect, it } from "vitest";
import { evaluateFormula } from "@vantage/scouting";
import { weightedFormula } from "./weighted-formula";

describe("coach weighting", () => {
  it("scores recorded fields using positive and negative weights while ignoring unusable selections", () => {
    const formula = weightedFormula({ cycles: 3, penalties: -2, notes: 0, invalid: NaN, unbounded: Infinity });
    expect(formula).not.toBeNull();
    expect(evaluateFormula(formula!, { cycles: 8, penalties: 2, notes: 99, invalid: 99, unbounded: 99 })).toBe(20);
  });
  it("does not create a score when the coach has selected no usable weights", () => {
    expect(weightedFormula({})).toBeNull();
    expect(weightedFormula({ cycles: 0, penalties: NaN })).toBeNull();
  });
});
