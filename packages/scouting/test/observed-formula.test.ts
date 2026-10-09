import { describe, expect, it } from "vitest";
import { evaluateObservedFormula, formulaFields, isFormulaExpression, isFormulaDraftExpression, type FormulaExpression } from "../src/formula";

const score: FormulaExpression = { op: "add", args: [
  { op: "multiply", args: [{ op: "field", field: "goals" }, { op: "constant", value: 3 }] },
  { op: "lookup", field: "climb", values: { none: 0, L1: 10, L2: 20 } },
] };

describe("scoring recorded observations", () => {
  it("scores counts and mapped climb answers without treating missing answers as zero", () => {
    expect(evaluateObservedFormula(score, { goals: 4, climb: "L2" })).toBe(32);
    expect(evaluateObservedFormula(score, { goals: 0, climb: "none" })).toBe(0);
    expect(evaluateObservedFormula(score, { goals: 4 })).toBeNull();
    expect(evaluateObservedFormula(score, { climb: "L2" })).toBeNull();
    expect(evaluateObservedFormula(score, { goals: "4", climb: "L2" })).toBeNull();
    expect(evaluateObservedFormula(score, { goals: 4, climb: "L3" })).toBeNull();
    expect(formulaFields(score)).toEqual(["goals", "climb"]);
  });
  it("keeps false and zero observable, even in answer mappings", () => {
    const boolean: FormulaExpression = { op: "lookup", field: "park", values: { true: 3, false: 0 } };
    expect(evaluateObservedFormula(boolean, { park: false })).toBe(0);
    expect(evaluateObservedFormula(boolean, {})).toBeNull();
  });
  it.each(["unknown", "could_not_see", "not_observed", "not_recorded", "unseen", " "])("does not turn %s into points even in a legacy mapping", answer => {
    expect(evaluateObservedFormula({ op: "lookup", field: "climb", values: { [answer]: 10 } }, { climb: answer })).toBeNull();
  });
  it("rejects zero division and overflow rather than displaying a fake score", () => {
    expect(evaluateObservedFormula({ op: "divide", args: [{ op: "constant", value: 4 }, { op: "field", field: "denominator" }] }, { denominator: 0 })).toBeNull();
    expect(evaluateObservedFormula({ op: "multiply", args: [{ op: "constant", value: Number.MAX_VALUE }, { op: "constant", value: 2 }] }, {})).toBeNull();
  });
  it("bounds malformed and recursive persisted expressions", () => {
    const recursive = { op: "add", args: [] as unknown[] }; recursive.args.push(recursive);
    expect(isFormulaExpression(recursive)).toBe(false);
    expect(formulaFields(recursive as unknown as FormulaExpression)).toEqual([]);
    expect(isFormulaExpression({ op: "add" })).toBe(false);
    expect(isFormulaExpression({ op: "add", args: Array.from({ length: 33 }, () => ({ op: "constant", value: 1 })) })).toBe(false);
    expect(isFormulaExpression({ op: "constant", value: Infinity })).toBe(false);
  });
  it("allows incomplete private drafts without allowing publication", () => {
    const unfinished = { op: "add", args: [{ op: "constant", value: NaN }, { op: "lookup", field: "climb", values: {} }] };
    expect(isFormulaDraftExpression(unfinished)).toBe(true);
    expect(isFormulaExpression(unfinished)).toBe(false);
  });
});
