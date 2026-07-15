import { describe, expect, it } from "vitest";
import {
  detectDisagreements,
  evaluateFormula,
  validatePayload,
  type SchemaDefinition,
} from "../src";

const schema: SchemaDefinition = {
  title: "2026 Match",
  fields: [
    { key: "auto", label: "Auto pieces", type: "number", required: true, disagreementThreshold: 1 },
    { key: "climb", label: "Climb", type: "select", options: ["none", "low", "high"] },
    { key: "disabled", label: "Disabled", type: "boolean" },
  ],
};

describe("version-pinned payload validation", () => {
  it("validates types, options, required values, and unknown fields", () => {
    expect(validatePayload(schema, { auto: 3, climb: "high", disabled: false })).toEqual([]);
    expect(validatePayload(schema, { climb: "sky", extra: 1 })).toEqual([
      "Unknown field: extra",
      "Auto pieces is required",
      "Climb has an invalid option",
    ]);
  });
});

describe("cross-scout disagreements", () => {
  it("flags threshold and categorical divergence while excluding low confidence", () => {
    const conflicts = detectDisagreements(schema, [
      { id: "a", confidence: "normal", payload: { auto: 2, climb: "low" } },
      { id: "b", confidence: "high", payload: { auto: 4, climb: "high" } },
      { id: "c", confidence: "low", payload: { auto: 50, climb: "low" } },
    ]);
    expect(conflicts.map((conflict) => conflict.fieldKey)).toEqual(["auto", "climb"]);
    expect(conflicts[0]?.entryIds).toEqual(["a", "b"]);
  });
});

describe("coach value formulas", () => {
  it("evaluates a safe expression tree without dynamic code", () => {
    expect(
      evaluateFormula(
        {
          op: "add",
          args: [
            { op: "multiply", args: [{ op: "field", field: "auto" }, { op: "constant", value: 2 }] },
            { op: "field", field: "teleop" },
          ],
        },
        { auto: 3, teleop: 5 },
      ),
    ).toBe(11);
  });
});
