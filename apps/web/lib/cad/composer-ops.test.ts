import { describe, expect, it } from "vitest";
import {
  COMPOSER_NATIVE_OPS,
  COMPOSER_OP_FIELDS,
  appendComposerOp,
  composerPalette,
  emptyComposerParameters,
  parametersFromDraft,
  parseComposerOps,
  removeComposerOp,
  replaceComposerOp,
  serializeComposerOps,
} from "./composer-ops";

describe("composer native ops", () => {
  it("keeps an empty plan as []", () => {
    expect(parseComposerOps(undefined)).toEqual([]);
    expect(parseComposerOps(null)).toEqual([]);
    expect(parseComposerOps("")).toEqual([]);
    expect(parseComposerOps("[]")).toEqual([]);
    expect(parseComposerOps([])).toEqual([]);
    expect(parseComposerOps({ steps: [] })).toEqual([]);
    expect(serializeComposerOps([])).toEqual([]);
  });

  it("rejects invalid millimetre values", () => {
    expect(() =>
      parseComposerOps([{ operation: "create_sketch", parameters: { widthMm: -5, heightMm: 10 } }]),
    ).toThrow(/millimetres/i);
    expect(() => parseComposerOps([{ operation: "create_extrude", parameters: { depthMm: "abc" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_fillet", parameters: { radiusMm: "30 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_chamfer", parameters: { widthMm: "2 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_shell", parameters: { thicknessMm: 0 } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_hole", parameters: { diameterMm: 0 } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { spacingMm: "25 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { instanceCount: 0 } }])).toThrow(
      /integer/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { instanceCount: 1.5 } }])).toThrow(
      /integer/i,
    );
    expect(() => parseComposerOps([{ operation: "create_sketch", parameters: { widthMm: Number.NaN } }])).toThrow(
      /millimetres/i,
    );
  });

  it("does not include feature_script in the default palette", () => {
    expect(COMPOSER_NATIVE_OPS).not.toContain("feature_script");
    expect(composerPalette()).not.toContain("feature_script");
    expect(composerPalette("onshape")).not.toContain("feature_script");
    expect(composerPalette("fusion360")).not.toContain("feature_script");
    expect(composerPalette("onshape")).toEqual([...COMPOSER_NATIVE_OPS]);
    expect(COMPOSER_NATIVE_OPS).toContain("create_chamfer");
    expect(COMPOSER_NATIVE_OPS).toContain("create_shell");
    expect(COMPOSER_NATIVE_OPS).toContain("create_pattern");
    expect(COMPOSER_NATIVE_OPS).toContain("create_mirror");
    expect(COMPOSER_NATIVE_OPS).toContain("set_variable");
    expect(composerPalette("onshape")).toEqual(
      expect.arrayContaining(["create_chamfer", "create_shell", "create_pattern", "create_mirror", "set_variable"]),
    );
    expect(composerPalette("fusion360")).toContain("create_chamfer");
    expect(composerPalette("fusion360")).not.toContain("create_shell");
    expect(composerPalette("fusion360")).not.toContain("create_pattern");
    expect(composerPalette("fusion360")).not.toContain("create_mirror");
    expect(composerPalette("fusion360")).not.toContain("set_variable");
  });

  it("does not invent DEMO plate sizes for empty params", () => {
    expect(emptyComposerParameters("create_sketch")).toEqual({});
    expect(emptyComposerParameters("create_chamfer")).toEqual({});
    expect(emptyComposerParameters("create_shell")).toEqual({});
    expect(emptyComposerParameters("create_pattern")).toEqual({});
    expect(emptyComposerParameters("create_mirror")).toEqual({});
    expect(emptyComposerParameters("set_variable")).toEqual({});
    expect(parseComposerOps([{ operation: "create_sketch", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_sketch", parameters: {}, reason: "" },
    ]);
    expect(serializeComposerOps(parseComposerOps([{ operation: "create_extrude", parameters: {} }]))).toEqual([
      { operation: "create_extrude", parameters: {}, reason: "" },
    ]);
  });

  it("round-trips typed native ops and drops feature_script", () => {
    const plan = parseComposerOps([
      {
        operation: "create_sketch",
        parameters: { width: 80, height: 40, plane: "Top" },
        reason: "Base profile",
      },
      { operation: "feature_script", parameters: { source: "opExtrude" }, reason: "escape hatch" },
      { operation: "create_fillet", parameters: { radiusMm: 2, entities: "E1, E2" }, reason: "Break edges" },
      { operation: "create_chamfer", parameters: { width: 1, entities: "E3" }, reason: "Lead-in" },
      { operation: "create_shell", parameters: { thickness: 2, entities: "F1" }, reason: "Hollow" },
      { operation: "create_hole", parameters: { diameterMm: 5, faceIds: "F2, F3" }, reason: "Through holes" },
      {
        operation: "create_pattern",
        parameters: { features: "FHole", count: 4, spacing: 25, direction: "X" },
        reason: "Bolt holes",
      },
      { operation: "create_mirror", parameters: { featureIds: "FCut", plane: "Right" }, reason: "Symmetry" },
    ]);
    expect(plan.map((step) => step.operation)).toEqual([
      "create_sketch",
      "create_fillet",
      "create_chamfer",
      "create_shell",
      "create_hole",
      "create_pattern",
      "create_mirror",
    ]);
    expect(serializeComposerOps(plan)).toEqual([
      {
        operation: "create_sketch",
        parameters: { widthMm: 80, heightMm: 40, plane: "Top" },
        reason: "Base profile",
      },
      {
        operation: "create_fillet",
        parameters: { radiusMm: 2, entities: ["E1", "E2"] },
        reason: "Break edges",
      },
      {
        operation: "create_chamfer",
        parameters: { widthMm: 1, entities: ["E3"] },
        reason: "Lead-in",
      },
      {
        operation: "create_shell",
        parameters: { thicknessMm: 2, entities: ["F1"] },
        reason: "Hollow",
      },
      {
        operation: "create_hole",
        parameters: { diameterMm: 5, faceIds: ["F2", "F3"] },
        reason: "Through holes",
      },
      {
        operation: "create_pattern",
        parameters: { featureIds: ["FHole"], instanceCount: 4, spacingMm: 25, direction: "X" },
        reason: "Bolt holes",
      },
      {
        operation: "create_mirror",
        parameters: { featureIds: ["FCut"], plane: "Right" },
        reason: "Symmetry",
      },
    ]);
  });

  it("exposes an idList so humans can pick hole faces", () => {
    expect(COMPOSER_OP_FIELDS.create_hole).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "faceIds", kind: "idList", label: "Faces" }),
      ]),
    );
  });

  it("exposes typed pattern and mirror fields without FeatureScript", () => {
    expect(COMPOSER_OP_FIELDS.create_pattern).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "spacingMm", kind: "mm" }),
        expect.objectContaining({ key: "instanceCount", kind: "count" }),
        expect.objectContaining({ key: "featureIds", kind: "idList" }),
        expect.objectContaining({ key: "axisIds", kind: "idList" }),
      ]),
    );
    expect(COMPOSER_OP_FIELDS.create_mirror).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "featureIds", kind: "idList" }),
        expect.objectContaining({ key: "planeIds", kind: "idList" }),
      ]),
    );
    expect(JSON.stringify(COMPOSER_OP_FIELDS.create_pattern)).not.toMatch(/featurescript|source/i);
    expect(JSON.stringify(COMPOSER_OP_FIELDS.create_mirror)).not.toMatch(/featurescript|source/i);
    expect(parametersFromDraft("create_pattern", { featureIds: "F1, F2", instanceCount: "3", spacingMm: "20" })).toEqual({
      featureIds: ["F1", "F2"],
      instanceCount: 3,
      spacingMm: 20,
    });
    expect(parseComposerOps([{ operation: "create_pattern", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_pattern", parameters: {}, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "create_mirror", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_mirror", parameters: {}, reason: "" },
    ]);
  });

  it("exposes set_variable as name + expression text, not FeatureScript", () => {
    expect(COMPOSER_OP_FIELDS.set_variable).toEqual([
      expect.objectContaining({ key: "name", kind: "text" }),
      expect.objectContaining({ key: "expression", kind: "text" }),
      expect.objectContaining({ key: "variableStudioElementId", kind: "text" }),
    ]);
    expect(COMPOSER_OP_FIELDS.set_variable.map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: "name", kind: "text" },
      { key: "expression", kind: "text" },
      { key: "variableStudioElementId", kind: "text" },
    ]);
    expect(COMPOSER_OP_FIELDS.set_variable.some((field) => field.key === "source")).toBe(false);
    expect(parametersFromDraft("set_variable", { name: "wallThickness", expression: "25 mm" })).toEqual({
      name: "wallThickness",
      expression: "25 mm",
    });
    expect(
      parametersFromDraft("set_variable", {
        name: "wallThickness",
        expression: "25 mm",
        variableStudioElementId: "vs-real",
      }),
    ).toEqual({
      name: "wallThickness",
      expression: "25 mm",
      variableStudioElementId: "vs-real",
    });
    expect(
      parseComposerOps([{ operation: "set_variable", parameters: { name: "holeDia", expression: "25 mm" } }]),
    ).toEqual([
      {
        id: "step-1",
        operation: "set_variable",
        parameters: { name: "holeDia", expression: "25 mm" },
        reason: "",
      },
    ]);
    expect(parseComposerOps([{ operation: "set_variable", parameters: {} }])).toEqual([
      { id: "step-1", operation: "set_variable", parameters: {}, reason: "" },
    ]);
  });

  it("refuses DEMO variable names and expressions", () => {
    expect(() => parseComposerOps([{ operation: "set_variable", parameters: { name: "DEMO" } }])).toThrow(
      /DEMO variable name/i,
    );
    expect(() => parseComposerOps([{ operation: "set_variable", parameters: { name: "demoWidth" } }])).toThrow(
      /DEMO variable name/i,
    );
    expect(() =>
      parseComposerOps([{ operation: "set_variable", parameters: { name: "wallThickness", expression: "DEMO" } }]),
    ).toThrow(/DEMO variable value/i);
    expect(() => parametersFromDraft("set_variable", { name: "demoPlate", expression: "25 mm" })).toThrow(
      /DEMO variable name/i,
    );
    expect(() => parametersFromDraft("set_variable", { name: "wallThickness", expression: "demo-1" })).toThrow(
      /DEMO variable value/i,
    );
    expect(() =>
      parametersFromDraft("set_variable", {
        name: "wallThickness",
        expression: "25 mm",
        variableStudioElementId: "DEMO",
      }),
    ).toThrow(/DEMO Variable Studio/i);
  });

  it("edits and deletes an existing planned step", () => {
    let plan = parseComposerOps([
      { operation: "create_sketch", parameters: { widthMm: 10, heightMm: 10 }, reason: "Stock" },
      { operation: "create_extrude", parameters: { depthMm: 6 }, reason: "Solid" },
    ]);
    plan = replaceComposerOp(plan, "step-2", {
      operation: "create_extrude",
      parameters: { depthMm: 12 },
      reason: "Thicker solid",
    });
    expect(serializeComposerOps(plan)[1]).toEqual({
      operation: "create_extrude",
      parameters: { depthMm: 12 },
      reason: "Thicker solid",
    });
    plan = removeComposerOp(plan, "step-1");
    expect(plan.map((step) => step.operation)).toEqual(["create_extrude"]);
    plan = appendComposerOp(plan, {
      operation: "verify_topology",
      parameters: {},
      reason: "Check bodies",
    });
    expect(plan.map((step) => step.operation)).toEqual(["create_extrude", "verify_topology"]);
  });
});
