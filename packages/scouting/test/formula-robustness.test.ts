import { describe, expect, it } from "vitest";
import { evaluateFormula, type FormulaExpression } from "../src/index";

/**
 * A formula lives in a jsonb column, so its shape is whatever was written
 * there — by an older builder, a hand-edited row, or a migration. It must not
 * be possible for a saved formula to take a scouting screen down.
 */
describe("a formula that is not the shape it should be", () => {
  const payload = { total_points: 42, auto_points: 10 };

  it("reads a well-formed field", () => {
    expect(evaluateFormula({ op: "field", field: "total_points" }, payload)).toBe(42);
  });

  it("does not throw on an operator node with no args", () => {
    // This is the exact row that produced "Cannot read properties of
    // undefined (reading 'map')" as a 500 on the Robots screen.
    const broken = { op: "add" } as unknown as FormulaExpression;
    expect(() => evaluateFormula(broken, payload)).not.toThrow();
    expect(evaluateFormula(broken, payload)).toBe(0);
  });

  it("does not throw when args is not an array", () => {
    const broken = { op: "multiply", args: { field: "total_points" } } as unknown as FormulaExpression;
    expect(evaluateFormula(broken, payload)).toBe(0);
  });

  it("returns a number for an operator nobody has implemented", () => {
    // Falling out of the switch returned undefined, which poisoned every
    // total downstream with NaN rather than failing visibly.
    const future = { op: "median", args: [] } as unknown as FormulaExpression;
    const result = evaluateFormula(future, payload);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(0);
  });

  it("lets the rest of a formula survive one bad branch", () => {
    // One field going quiet, rather than a whole event becoming unreadable.
    const mixed: FormulaExpression = {
      op: "add",
      args: [
        { op: "field", field: "auto_points" },
        { op: "add" } as unknown as FormulaExpression,
        { op: "constant", value: 5 },
      ],
    };
    expect(evaluateFormula(mixed, payload)).toBe(15);
  });

  it("treats a missing field as zero rather than NaN", () => {
    expect(evaluateFormula({ op: "field", field: "not_collected" }, payload)).toBe(0);
  });
});
