import { describe, expect, it } from "vitest";
import { validatePayload, type SchemaDefinition } from "@vantage/scouting";
import {
  conditionProblems,
  danglingConditions,
  detectConditionCycles,
  evaluateVisibility,
  hiddenFieldKeys,
  visibleFieldsForPayload,
} from "./conditional";

const schema: SchemaDefinition = {
  title: "Conditional",
  fields: [
    { key: "climbed", label: "Climbed", type: "boolean" },
    {
      key: "climb_level",
      label: "Climb level",
      type: "select",
      options: ["L1", "L2", "L3"],
      required: true,
      config: { visibleWhen: { fieldKey: "climbed", op: "truthy" } },
    },
    {
      key: "fell_off",
      label: "Fell off after L3?",
      type: "boolean",
      config: { visibleWhen: { fieldKey: "climb_level", op: "eq", value: "L3" } },
    },
    { key: "auto_score", label: "Auto score", type: "number" },
    {
      key: "auto_notes",
      label: "Why so high?",
      type: "text",
      required: true,
      config: { visibleWhen: { fieldKey: "auto_score", op: "gt", value: 20 } },
    },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

describe("visibleFieldsForPayload", () => {
  it("hides dependent fields until the controller matches", () => {
    expect(visibleFieldsForPayload(schema, {}).map((field) => field.key)).toEqual([
      "climbed",
      "auto_score",
      "notes",
    ]);
    expect(visibleFieldsForPayload(schema, { climbed: true }).map((field) => field.key)).toEqual([
      "climbed",
      "climb_level",
      "auto_score",
      "notes",
    ]);
  });

  it("follows the chain: a hidden controller hides its dependents even if their own condition holds", () => {
    // climb_level holds the value that would show fell_off, but climbed is false.
    const keys = visibleFieldsForPayload(schema, { climbed: false, climb_level: "L3" }).map((field) => field.key);
    expect(keys).not.toContain("climb_level");
    expect(keys).not.toContain("fell_off");
    expect(visibleFieldsForPayload(schema, { climbed: true, climb_level: "L3" }).map((f) => f.key)).toContain("fell_off");
  });

  it("supports numeric comparisons with string answers", () => {
    expect(evaluateVisibility(schema.fields[4]!, { auto_score: "25" }, schema)).toBe(true);
    expect(evaluateVisibility(schema.fields[4]!, { auto_score: 20 }, schema)).toBe(false);
    expect(evaluateVisibility(schema.fields[4]!, {}, schema)).toBe(false);
  });

  it("reports hidden keys", () => {
    expect(hiddenFieldKeys(schema, {})).toEqual(["climb_level", "fell_off", "auto_notes"]);
  });
});

describe("validatePayload with conditions", () => {
  it("skips a required field the scout could not see", () => {
    expect(validatePayload(schema, { climbed: false, auto_score: 5 })).toEqual([]);
  });

  it("still requires it once visible", () => {
    expect(validatePayload(schema, { climbed: true, auto_score: 5 })).toEqual(["Climb level is required"]);
    expect(validatePayload(schema, { climbed: true, climb_level: "L2", auto_score: 30 })).toEqual([
      "Why so high? is required",
    ]);
  });

  it("still type-checks an answer given to a hidden field", () => {
    expect(validatePayload(schema, { climbed: false, climb_level: "L9" })).toEqual([
      "Climb level has an invalid option",
    ]);
  });
});

describe("detectConditionCycles", () => {
  const cyclic: SchemaDefinition = {
    title: "loop",
    fields: [
      { key: "a", label: "A", type: "boolean", config: { visibleWhen: { fieldKey: "b", op: "truthy" } } },
      { key: "b", label: "B", type: "boolean", config: { visibleWhen: { fieldKey: "c", op: "truthy" } } },
      { key: "c", label: "C", type: "boolean", config: { visibleWhen: { fieldKey: "a", op: "truthy" } } },
      { key: "d", label: "D", type: "boolean", config: { visibleWhen: { fieldKey: "a", op: "truthy" } } },
      { key: "e", label: "E", type: "boolean", config: { visibleWhen: { fieldKey: "e", op: "truthy" } } },
      { key: "f", label: "F", type: "boolean", config: { visibleWhen: { fieldKey: "ghost", op: "truthy" } } },
    ],
  };

  it("finds each loop once and ignores fields that merely point into it", () => {
    const cycles = detectConditionCycles(cyclic);
    expect(cycles).toHaveLength(2);
    expect(cycles.map((cycle) => [...cycle].sort().join(""))).toEqual(["abc", "e"]);
  });

  it("returns nothing for an acyclic schema", () => {
    expect(detectConditionCycles(schema)).toEqual([]);
  });

  it("fails open: fields in a loop stay visible and required", () => {
    expect(visibleFieldsForPayload(cyclic, {}).map((field) => field.key)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("flags dangling and self references for the builder", () => {
    expect(danglingConditions(cyclic)).toEqual([
      { fieldKey: "e", missingKey: "e" },
      { fieldKey: "f", missingKey: "ghost" },
    ]);
    const problems = conditionProblems(cyclic);
    expect(problems.some((line) => line.includes("own answer"))).toBe(true);
    expect(problems.some((line) => line.includes("no longer exists"))).toBe(true);
    expect(problems.some((line) => line.startsWith("Visibility loop"))).toBe(true);
  });
});
