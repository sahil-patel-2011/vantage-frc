import { describe, expect, it } from "vitest";
import {
  chamferFeature,
  circleSketchFeature,
  circularPatternFeature,
  extrudeFeature,
  filletFeature,
  holeFeature,
  linearPatternFeature,
  mirrorFeature,
  onshapeFeaturePath,
  onshapePlaneNormal,
  patternAxisPlaneId,
  pointsSketchFeature,
  polylineSketchFeature,
  rectangleSketchFeature,
} from "../src/onshape-features";

// `queries` and `featureIds` are named explicitly so assertions can index them;
// the index signature keeps every other BTM parameter field reachable.
type AnyParam = {
  btType: string;
  parameterId: string;
  queries?: Array<Record<string, unknown>>;
  featureIds?: string[];
  [key: string]: unknown;
};

function params(payload: { feature: { parameters?: unknown } }): AnyParam[] {
  return (payload.feature.parameters ?? []) as AnyParam[];
}

function param(payload: { feature: { parameters?: unknown } }, parameterId: string): AnyParam {
  const found = params(payload).find((entry) => entry.parameterId === parameterId);
  if (!found) throw new Error(`missing parameter ${parameterId}`);
  return found;
}

describe("sketch payloads", () => {
  it("builds a circle sketch with radius in metres and mm centres", () => {
    const sketch = circleSketchFeature({
      plane: "Front",
      circles: [{ diameterMm: 10, centerXMm: 20, centerYMm: -5 }],
    });
    expect(sketch.feature.featureType).toBe("newSketch");
    const entity = (sketch.feature.entities as Array<Record<string, unknown>>)[0]!;
    expect(entity.btType).toBe("BTMSketchCurve-4");
    const geometry = entity.geometry as Record<string, number | string>;
    expect(geometry.btType).toBe("BTCurveGeometryCircle-115");
    expect(geometry.radius).toBeCloseTo(0.005, 10);
    expect(geometry.xCenter).toBeCloseTo(0.02, 10);
    expect(geometry.yCenter).toBeCloseTo(-0.005, 10);
    expect(param(sketch, "sketchPlane").queries).toEqual([
      { btType: "BTMIndividualQuery-138", deterministicIds: ["JCC"] },
    ]);
  });

  it("closes a polyline into a region and rejects duplicate points", () => {
    const closed = polylineSketchFeature({
      points: [
        { xMm: 0, yMm: 0 },
        { xMm: 40, yMm: 0 },
        { xMm: 40, yMm: 25 },
      ],
      closed: true,
    });
    expect(closed.feature.entities).toHaveLength(3);
    const open = polylineSketchFeature({
      points: [
        { xMm: 0, yMm: 0 },
        { xMm: 40, yMm: 0 },
        { xMm: 40, yMm: 25 },
      ],
      closed: false,
    });
    expect(open.feature.entities).toHaveLength(2);
    expect(() =>
      polylineSketchFeature({
        points: [
          { xMm: 5, yMm: 5 },
          { xMm: 5, yMm: 5 },
        ],
      }),
    ).toThrow(/same point/i);
  });

  it("builds sketch points for hole locations", () => {
    const points = pointsSketchFeature({ points: [{ xMm: 0, yMm: 0 }, { xMm: 20, yMm: 0 }] });
    const entities = points.feature.entities as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(2);
    expect(entities[0]!.btType).toBe("BTMSketchPoint-158");
    expect(entities[1]!.x).toBeCloseTo(0.02, 10);
    expect(() => pointsSketchFeature({ points: [] })).toThrow(/at least one point/i);
  });

  it("offsets a rectangle from the sketch origin", () => {
    const sketch = rectangleSketchFeature({ widthMm: 40, heightMm: 20, originXMm: -20, originYMm: -10 });
    const first = (sketch.feature.entities as Array<Record<string, unknown>>)[0]!;
    expect((first.geometry as Record<string, number>).pntX).toBeCloseTo(-0.02, 10);
  });
});

describe("solid + modify payloads", () => {
  it("extrudes with an explicit operation type", () => {
    const cut = extrudeFeature({ sketchFeatureId: "FSketch", depthMm: 6, operationType: "REMOVE" });
    expect(param(cut, "operationType").value).toBe("REMOVE");
    expect(param(cut, "depth").value).toBeCloseTo(0.006, 10);
    expect(param(cut, "depth").expression).toBe("6 mm");
    expect(() => extrudeFeature({ sketchFeatureId: "F", depthMm: 1, operationType: "BOGUS" as never })).toThrow(
      /operationType/,
    );
  });

  it("sends only entities + radius for a fillet, using resolved edge ids", () => {
    const fillet = filletFeature({ edgeIds: ["JHD", "JHE"], radiusMm: 5 });
    expect(fillet.feature.featureType).toBe("fillet");
    expect(params(fillet).map((entry) => entry.parameterId).sort()).toEqual(["entities", "radius"]);
    expect(param(fillet, "entities").queries).toEqual([
      { btType: "BTMIndividualQuery-138", deterministicIds: ["JHD", "JHE"] },
    ]);
    expect(param(fillet, "radius").value).toBeCloseTo(0.005, 10);
  });

  it("refuses to build a fillet or chamfer without real edges", () => {
    expect(() => filletFeature({ edgeIds: [], radiusMm: 5 })).toThrow(/never guesses/i);
    expect(() => chamferFeature({ edgeIds: ["  "], widthMm: 2 })).toThrow(/never guesses/i);
  });

  it("builds a THROUGH hole and requires depth for BLIND", () => {
    const through = holeFeature({ locationIds: ["V1", "V2"], scopeIds: ["B1"], diameterMm: 5 });
    expect(through.feature.featureType).toBe("hole");
    expect(param(through, "style").value).toBe("SIMPLE");
    expect(param(through, "endStyle").value).toBe("THROUGH");
    expect(param(through, "holeDiameter").value).toBeCloseTo(0.005, 10);
    expect(param(through, "locations").queries?.[0]).toEqual({
      btType: "BTMIndividualQuery-138",
      deterministicIds: ["V1", "V2"],
    });
    expect(params(through).some((entry) => entry.parameterId === "holeDepth")).toBe(false);

    expect(() => holeFeature({ locationIds: ["V1"], scopeIds: ["B1"], diameterMm: 5, endStyle: "BLIND" })).toThrow(
      /depthMm/,
    );
    const blind = holeFeature({
      locationIds: ["V1"],
      scopeIds: ["B1"],
      diameterMm: 5,
      endStyle: "BLIND",
      depthMm: 4,
    });
    expect(param(blind, "holeDepth").value).toBeCloseTo(0.004, 10);
  });
});

describe("pattern payloads", () => {
  it("maps world axes to the standard plane that carries that normal", () => {
    expect(patternAxisPlaneId("x")).toBe("JEC");
    expect(patternAxisPlaneId("Y")).toBe("JCC");
    expect(patternAxisPlaneId("Z")).toBe("JDC");
    expect(() => patternAxisPlaneId("diagonal")).toThrow(/direction must be/i);
    expect(onshapePlaneNormal("Top")).toEqual([0, 0, 1]);
  });

  it("builds a feature linear pattern with an integer instance count", () => {
    const pattern = linearPatternFeature({
      featureIds: ["FHole"],
      directionIds: [patternAxisPlaneId("X")],
      spacingMm: 20,
      instanceCount: 4,
    });
    expect(pattern.feature.featureType).toBe("linearPattern");
    expect(param(pattern, "patternType").value).toBe("FEATURE");
    expect(param(pattern, "instanceFunction")).toMatchObject({
      btType: "BTMParameterFeatureList-1749",
      featureIds: ["FHole"],
    });
    expect(param(pattern, "instanceCount")).toMatchObject({ isInteger: true, value: 4 });
    expect(param(pattern, "distance").value).toBeCloseTo(0.02, 10);
    expect(() =>
      linearPatternFeature({ featureIds: ["F"], directionIds: ["JEC"], spacingMm: 10, instanceCount: 1 }),
    ).toThrow(/whole number between 2/i);
  });

  it("builds a circular pattern in radians and rejects a bad sweep", () => {
    const pattern = circularPatternFeature({ featureIds: ["FHole"], axisIds: ["JFACE"], instanceCount: 6 });
    expect(param(pattern, "angle").value).toBeCloseTo(Math.PI * 2, 10);
    expect(param(pattern, "equalSpacing").value).toBe(true);
    expect(() =>
      circularPatternFeature({ featureIds: ["F"], axisIds: ["A"], instanceCount: 3, angleDeg: 400 }),
    ).toThrow(/angleDeg/);
  });

  it("mirrors across a standard plane without resolving geometry", () => {
    const mirror = mirrorFeature({ featureIds: ["FCut"], plane: "Right" });
    expect(mirror.feature.featureType).toBe("mirror");
    expect(param(mirror, "patternType")).toMatchObject({ enumName: "MirrorType", value: "FEATURE" });
    expect(param(mirror, "mirrorPlane").queries?.[0]).toEqual({
      btType: "BTMIndividualQuery-138",
      deterministicIds: ["JEC"],
    });
  });
});

describe("feature paths", () => {
  it("builds the add and delete paths", () => {
    const doc = { documentId: "d1", workspaceId: "w1", elementId: "e1" };
    expect(onshapeFeaturePath(doc)).toBe("/partstudios/d/d1/w/w1/e/e1/features");
    expect(onshapeFeaturePath(doc, "F Wx/1")).toBe("/partstudios/d/d1/w/w1/e/e1/features/featureid/F%20Wx%2F1");
  });
});
