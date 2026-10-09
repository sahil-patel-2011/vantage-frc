import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormulaExpression } from "@vantage/scouting";
import { formulaForRole, formulaDraftKey, latestFormulaDraft, readFormulaDraft, formulaInputError, type SavedFormula } from "./formula-editor";

const fields: FieldDefinition[] = [{ key: "goals", label: "Goals", type: "counter" }, { key: "climb", label: "Climb", type: "select", options: ["none", "L1", "could_not_see"] }];
const row = (name: string): SavedFormula => ({ id: name, name, expression: { op: "field", field: "goals" }, revision: "2026-10-09 01:01:01.123456+00", updatedAt: "2026-10-09T01:01:01.123Z" });
const raw = (savedAt: string) => JSON.stringify({ name: "Total points", expression: { op: "constant", value: NaN }, baseRevision: null, schemaId: "schema", savedAt });

describe("scoring editor identity and recovery", () => {
  it("selects the formula analysis uses, preserving its existing name and alias priority", () => {
    expect(formulaForRole([row("Pick value"), row("Total points"), row("total")], "Total points")?.name).toBe("total");
    expect(formulaForRole([row("auto_points")], "Auto")?.name).toBe("auto_points");
    expect(formulaForRole([row("Pick value")], "Total points")).toBeUndefined();
  });
  it("restores intentionally unfilled numeric inputs without changing them to zero", () => {
    const draft = readFormulaDraft(raw("2026-10-09T12:00:00Z"));
    expect(draft?.expression.op).toBe("constant");
    expect(Number.isNaN((draft?.expression as { value: number }).value)).toBe(true);
    expect(readFormulaDraft('{"expression":{"op":"add"}}')).toBeNull();
  });
  it("recovers the latest editor revision only for this user, team and exact formula", () => {
    const prefix = formulaDraftKey("lead", "team-one", "Total points");
    const entries = new Map([
      [`${prefix}:editor-a`, raw("2026-10-09T12:00:00Z")],
      [`${prefix}:editor-b`, raw("2026-10-09T13:00:00Z")],
      [`${formulaDraftKey("other", "team-one", "Total points")}:editor-c`, raw("2026-10-09T14:00:00Z")],
      [`${formulaDraftKey("lead", "team-two", "Total points")}:editor-d`, raw("2026-10-09T14:00:00Z")],
    ]);
    const storage = { length: entries.size, key: (index: number) => [...entries.keys()][index] ?? null, getItem: (key: string) => entries.get(key) ?? null };
    expect(latestFormulaDraft(storage, prefix)?.key).toBe(`${prefix}:editor-b`);
    expect(entries.size).toBe(4);
  });
  it("rejects retired questions, mismatched answer types and unseen mappings", () => {
    expect(formulaInputError({ op: "field", field: "retired" }, fields)).toContain("not in");
    expect(formulaInputError({ op: "field", field: "climb" }, fields)).toContain("points per answer");
    expect(formulaInputError({ op: "lookup", field: "climb", values: { L1: 10 } }, fields)).toBeNull();
    expect(formulaInputError({ op: "lookup", field: "climb", values: { L3: 30 } }, fields)).toContain("Review");
    expect(formulaInputError({ op: "lookup", field: "climb", values: { could_not_see: 0 } }, fields)).toContain("unknown");
    expect(formulaInputError({ op: "multiply", args: [{ op: "field", field: "goals" }, { op: "constant", value: 3 }] } as FormulaExpression, fields)).toBeNull();
  });
});
