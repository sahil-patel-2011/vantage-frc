import { describe, expect, it } from "vitest";
import { rememberComposerFeature } from "./remember-feature";

const FEATURE = "FWx/real-extrude-1";

function sketchOp(parameters: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    operation: "create_sketch" as const,
    parameters,
    reason: "Stock",
  };
}

describe("rememberComposerFeature", () => {
  it("copies result.featureId onto parameters.featureId", () => {
    const op = sketchOp({ widthMm: 80, heightMm: 40 });
    const remembered = rememberComposerFeature(op, { featureId: FEATURE });
    expect(remembered.parameters.featureId).toBe(FEATURE);
    expect(op.parameters.featureId).toBe(FEATURE);
    expect(remembered).toBe(op);
  });

  it("falls back to result.result.featureId when the top-level id is missing", () => {
    const op = sketchOp({ depthMm: 6 });
    rememberComposerFeature(op, {
      action: "execute-onshape",
      result: { featureId: FEATURE },
    });
    expect(op.parameters.featureId).toBe(FEATURE);
  });

  it("prefers the top-level result.featureId over a nested one", () => {
    const op = sketchOp({});
    rememberComposerFeature(op, {
      featureId: "Ftop-level",
      result: { featureId: "Fnested" },
    });
    expect(op.parameters.featureId).toBe("Ftop-level");
  });

  it("does not treat DEMO or blank ids as real feature ids", () => {
    const op = sketchOp({ widthMm: 10 });
    rememberComposerFeature(op, { featureId: "DEMO-plate" });
    expect(op.parameters).not.toHaveProperty("featureId");

    rememberComposerFeature(op, { featureId: "demo-extrude", result: { featureId: "  " } });
    expect(op.parameters).not.toHaveProperty("featureId");

    rememberComposerFeature(op, { featureId: "", result: { featureId: "\t" } });
    expect(op.parameters).not.toHaveProperty("featureId");
    expect(JSON.stringify(op.parameters)).not.toMatch(/demo/i);
  });

  it("skips DEMO at the top level and still copies a nested real id", () => {
    const op = sketchOp({});
    rememberComposerFeature(op, { featureId: "DEMO-plate", result: { featureId: FEATURE } });
    expect(op.parameters.featureId).toBe(FEATURE);
  });

  it("does not invent a featureId when none was returned", () => {
    const op = sketchOp({ widthMm: 80 });
    rememberComposerFeature(op, { action: "execute-onshape", result: {} });
    rememberComposerFeature(op, null);
    rememberComposerFeature(op, undefined);
    rememberComposerFeature(op, { featureId: 12, result: { featureId: null } });
    expect(op.parameters).not.toHaveProperty("featureId");
    expect(JSON.stringify(op.parameters)).not.toMatch(/demo/i);
  });

  it("leaves an existing real parameters.featureId when the result has none", () => {
    const op = sketchOp({ featureId: FEATURE, depthMm: 6 });
    rememberComposerFeature(op, { result: { shadedPngBase64: "abc" } });
    expect(op.parameters.featureId).toBe(FEATURE);
  });

  it("does not overwrite a real parameters.featureId with DEMO or blank", () => {
    const op = sketchOp({ featureId: FEATURE });
    rememberComposerFeature(op, { featureId: "DEMO-plate" });
    expect(op.parameters.featureId).toBe(FEATURE);
    rememberComposerFeature(op, { featureId: "   " });
    expect(op.parameters.featureId).toBe(FEATURE);
  });

  it("trims a real returned id before storing it", () => {
    const op = sketchOp({});
    rememberComposerFeature(op, { featureId: `  ${FEATURE}  ` });
    expect(op.parameters.featureId).toBe(FEATURE);
  });
});
