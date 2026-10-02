import type { FormulaExpression } from "@vantage/scouting";

/** Build the coach's weighting using only usable terms; an empty selection has no formula. */
export function weightedFormula(weights: Record<string, number>): FormulaExpression | null {
  const args: FormulaExpression[] = Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && weight !== 0)
    .map(([field, value]) => ({ op: "multiply", args: [{ op: "field", field }, { op: "constant", value }] }));
  return args.length ? { op: "add", args } : null;
}
