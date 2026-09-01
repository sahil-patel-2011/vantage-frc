import { describe, expect, it } from "vitest";
import {
  COMPOSER_NATIVE_OPS,
  appendComposerOp,
  composerPalette,
  emptyComposerParameters,
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
    expect(() => parseComposerOps([{ operation: "create_hole", parameters: { diameterMm: 0 } }])).toThrow(
      /millimetres/i,
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
  });

  it("does not invent DEMO plate sizes for empty params", () => {
    expect(emptyComposerParameters("create_sketch")).toEqual({});
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
    ]);
    expect(plan.map((step) => step.operation)).toEqual(["create_sketch", "create_fillet"]);
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
    ]);
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
