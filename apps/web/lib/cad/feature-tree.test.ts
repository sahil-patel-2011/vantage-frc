import { describe, expect, it } from "vitest";
import { parseExplainFeatures, updateFeaturePayload } from "./feature-tree";

const EXTRUDE_ID = "FWx/real-extrude-1";
const SKETCH_ID = "FWx/real-sketch-1";

const API_EXPLAIN = {
  features: [
    { id: SKETCH_ID, name: "Sketch 1", featureType: "newSketch", suppressed: false },
    { id: EXTRUDE_ID, name: "Extrude 1", featureType: "extrude", suppressed: false },
  ],
  explain: {
    overview: "This Part Studio builds geometry in 2 active steps.",
    steps: [
      { order: 1, name: "Sketch 1", featureType: "newSketch", plainEnglish: "A 2D drawing." },
      { order: 2, name: "Extrude 1", featureType: "extrude", plainEnglish: "Pushes a sketch into 3D." },
    ],
    suppressedCount: 0,
    disclaimer: "Educational explanation only.",
  },
};

describe("parseExplainFeatures", () => {
  it("maps explain-onshape-features JSON to featureId/name/type", () => {
    expect(parseExplainFeatures(API_EXPLAIN)).toEqual([
      { featureId: SKETCH_ID, name: "Sketch 1", type: "newSketch" },
      { featureId: EXTRUDE_ID, name: "Extrude 1", type: "extrude" },
    ]);
  });

  it("reads raw Onshape featureId + message fields", () => {
    expect(
      parseExplainFeatures({
        features: [
          { featureId: SKETCH_ID, message: { name: "Base plate", featureType: "newSketch" } },
          { featureId: EXTRUDE_ID, message: { name: "Thicken", featureType: "extrude" } },
        ],
      }),
    ).toEqual([
      { featureId: SKETCH_ID, name: "Base plate", type: "newSketch" },
      { featureId: EXTRUDE_ID, name: "Thicken", type: "extrude" },
    ]);
  });

  it("accepts a features array or a JSON string", () => {
    const rows = [
      { featureId: EXTRUDE_ID, name: "Extrude 1", type: "extrude" },
      { featureId: SKETCH_ID, name: "Sketch 1", featureType: "newSketch" },
    ];
    expect(parseExplainFeatures(rows)).toEqual([
      { featureId: EXTRUDE_ID, name: "Extrude 1", type: "extrude" },
      { featureId: SKETCH_ID, name: "Sketch 1", type: "newSketch" },
    ]);
    expect(parseExplainFeatures(JSON.stringify({ features: rows }))).toEqual([
      { featureId: EXTRUDE_ID, name: "Extrude 1", type: "extrude" },
      { featureId: SKETCH_ID, name: "Sketch 1", type: "newSketch" },
    ]);
  });

  it("never invents IDs — drops blank, missing, and explain-only steps", () => {
    expect(parseExplainFeatures(undefined)).toEqual([]);
    expect(parseExplainFeatures(null)).toEqual([]);
    expect(parseExplainFeatures("")).toEqual([]);
    expect(parseExplainFeatures("{")).toEqual([]);
    expect(parseExplainFeatures({ explain: API_EXPLAIN.explain })).toEqual([]);
    expect(
      parseExplainFeatures({
        features: [
          { name: "Orphan", featureType: "extrude" },
          { id: "   ", name: "Whitespace id", featureType: "fillet" },
          { featureId: "", name: "Empty featureId", type: "shell" },
          { id: EXTRUDE_ID, name: "Kept", featureType: "extrude" },
        ],
      }),
    ).toEqual([{ featureId: EXTRUDE_ID, name: "Kept", type: "extrude" }]);
    const invented = parseExplainFeatures({
      features: [{ name: "Sketch 1", featureType: "newSketch" }],
      explain: API_EXPLAIN.explain,
    });
    expect(invented).toEqual([]);
    expect(JSON.stringify(invented)).not.toMatch(/feature-1|DEMO|Sketch 1/i);
  });

  it("does not fill missing name or type with placeholder labels", () => {
    expect(parseExplainFeatures({ features: [{ featureId: EXTRUDE_ID }] })).toEqual([
      { featureId: EXTRUDE_ID, name: "", type: "" },
    ]);
  });
});

describe("updateFeaturePayload", () => {
  it("builds an update-onshape-feature body from a real featureId", () => {
    expect(updateFeaturePayload({ featureId: EXTRUDE_ID, depthMm: 6 })).toEqual({
      action: "update-onshape-feature",
      featureId: EXTRUDE_ID,
      depthMm: 6,
    });
    expect(updateFeaturePayload({ featureId: EXTRUDE_ID })).toEqual({
      action: "update-onshape-feature",
      featureId: EXTRUDE_ID,
    });
    expect(
      updateFeaturePayload({ featureId: SKETCH_ID, widthMm: "80", heightMm: 40 }),
    ).toEqual({
      action: "update-onshape-feature",
      featureId: SKETCH_ID,
      widthMm: 80,
      heightMm: 40,
    });
  });

  it("refuses DEMO and blank ids without inventing a replacement", () => {
    expect(() => updateFeaturePayload({ featureId: "", depthMm: 6 })).toThrow(/featureId Onshape returned/i);
    expect(() => updateFeaturePayload({ featureId: "   ", depthMm: 6 })).toThrow(/featureId Onshape returned/i);
    expect(() => updateFeaturePayload({ featureId: undefined, depthMm: 6 })).toThrow(/featureId Onshape returned/i);
    expect(() => updateFeaturePayload({ featureId: null, depthMm: 6 })).toThrow(/featureId Onshape returned/i);
    expect(() => updateFeaturePayload({ featureId: "DEMO", depthMm: 6 })).toThrow(/DEMO feature id/i);
    expect(() => updateFeaturePayload({ featureId: "demo-plate", depthMm: 8 })).toThrow(/DEMO feature id/i);
    expect(() => updateFeaturePayload({ featureId: 12 as unknown as string, depthMm: 6 })).toThrow(
      /featureId Onshape returned/i,
    );
  });

  it("refuses invalid millimetre values", () => {
    expect(() => updateFeaturePayload({ featureId: EXTRUDE_ID, depthMm: 0 })).toThrow(/millimetres/i);
    expect(() => updateFeaturePayload({ featureId: EXTRUDE_ID, depthMm: -4 })).toThrow(/millimetres/i);
    expect(() => updateFeaturePayload({ featureId: EXTRUDE_ID, depthMm: "abc" })).toThrow(/millimetres/i);
    expect(() => updateFeaturePayload({ featureId: EXTRUDE_ID, depthMm: Number.NaN })).toThrow(/millimetres/i);
  });
});
