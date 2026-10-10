export type FormulaExpression =
  | { op: "field"; field: string }
  | { op: "constant"; value: number }
  | { op: "lookup"; field: string; values: Record<string, number> }
  | { op: "add" | "subtract" | "multiply" | "divide" | "min" | "max"; args: FormulaExpression[] };

/** Bound saved expressions before rendering or evaluating recursive nodes. */
function validFormula(input: unknown, incomplete: boolean): boolean {
  let nodes = 0;
  const fieldKey = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= 200
    && key.trim() === key && !["__proto__", "prototype", "constructor"].includes(key);
  function valid(value: unknown, depth: number): boolean {
    if (++nodes > 256 || depth > 12 || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const node = value as Record<string, unknown>;
    if (node.op === "constant") return typeof node.value === "number" && (Number.isFinite(node.value) || (incomplete && Number.isNaN(node.value)));
    if (node.op === "field") return fieldKey(node.field);
    if (node.op === "lookup") {
      if (!fieldKey(node.field) || !node.values || typeof node.values !== "object" || Array.isArray(node.values)) return false;
      const values = Object.entries(node.values);
      return (incomplete || values.length > 0) && values.length <= 200 && values.every(([key, amount]) => key.length <= 300 && typeof amount === "number" && (Number.isFinite(amount) || (incomplete && Number.isNaN(amount))));
    }
    return ["add", "subtract", "multiply", "divide", "min", "max"].includes(String(node.op))
      && Array.isArray(node.args) && (incomplete || node.args.length > 0) && node.args.length <= 32 && node.args.every(arg => valid(arg, depth + 1));
  }
  return valid(input, 0);
}

export function isFormulaExpression(input: unknown): input is FormulaExpression { return validFormula(input, false); }
export function isFormulaDraftExpression(input: unknown): input is FormulaExpression { return validFormula(input, true); }

export function formulaFields(expression: FormulaExpression): string[] {
  if (!isFormulaDraftExpression(expression)) return [];
  function collect(node: FormulaExpression): string[] {
    if (node.op === "field" || node.op === "lookup") return [node.field];
    return "args" in node ? node.args.flatMap(collect) : [];
  }
  return [...new Set(collect(expression))];
}

export function isUnseenFormulaAnswer(value: unknown): boolean {
  return value == null || (typeof value === "string" && (!value.trim() || /^(unknown|could_not_see|not_observed|not_recorded|unseen)$/i.test(value.trim())));
}

/** Explicit false and zero are observations; missing or unmapped values are not. */
export function evaluateObservedFormula(expression: FormulaExpression, payload: Record<string, unknown>): number | null {
  if (!isFormulaExpression(expression)) return null;
  function evaluate(node: FormulaExpression): number | null {
    if (node.op === "constant") return node.value;
    if (node.op === "field") {
      const value = payload[node.field];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    if (node.op === "lookup") {
      const value = payload[node.field];
      if (isUnseenFormulaAnswer(value)) return null;
      if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      const key = String(value);
      return Object.hasOwn(node.values, key) ? node.values[key]! : null;
    }
    const amounts = node.args.map(evaluate);
    if (amounts.some(amount => amount === null)) return null;
    const values = amounts as number[];
    let result: number;
    switch (node.op) {
      case "add": result = values.reduce((sum, value) => sum + value, 0); break;
      case "subtract": result = values.slice(1).reduce((sum, value) => sum - value, values[0]!); break;
      case "multiply": result = values.reduce((product, value) => product * value, 1); break;
      case "divide":
        if (values.slice(1).some(value => value === 0)) return null;
        result = values.slice(1).reduce((quotient, value) => quotient / value, values[0]!); break;
      case "min": result = Math.min(...values); break;
      case "max": result = Math.max(...values); break;
    }
    return Number.isFinite(result) ? result : null;
  }
  return evaluate(expression);
}
