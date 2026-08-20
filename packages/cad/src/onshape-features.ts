/** Minimal Onshape BTM payloads for rectangle sketch + extrude. Units: mm in, meters on the wire. */

const STANDARD_PLANES: Record<string, string> = {
  Front: "JCC",
  Top: "JDC",
  Right: "JEC",
};

export function onshapePlaneId(plane: string): string {
  const name = plane.trim() || "Top";
  const id = STANDARD_PLANES[name] ?? STANDARD_PLANES[name[0]!.toUpperCase() + name.slice(1).toLowerCase()];
  if (!id) throw new Error(`Unknown sketch plane "${plane}". Use Front, Top, or Right.`);
  return id;
}

function mmToMeters(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0 || mm > 10_000) throw new Error("Dimension must be a positive number of millimeters (max 10000).");
  return mm / 1000;
}

function lineEntity(id: string, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    startParam: 0,
    endParam: length,
    geometry: {
      btType: "BTCurveGeometryLine-117",
      pntX: x1,
      pntY: y1,
      dirX: dx / length,
      dirY: dy / length,
    },
    centerId: "",
    isConstruction: false,
  };
}

export function rectangleSketchFeature(input: {
  name?: string;
  plane?: string;
  widthMm: number;
  heightMm: number;
}) {
  const w = mmToMeters(input.widthMm);
  const h = mmToMeters(input.heightMm);
  return {
    feature: {
      btType: "BTMSketch-151",
      featureType: "newSketch",
      name: input.name?.trim() || "VantageSketch",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          queries: [
            {
              btType: "BTMIndividualQuery-138",
              deterministicIds: [onshapePlaneId(input.plane ?? "Top")],
            },
          ],
          parameterId: "sketchPlane",
        },
      ],
      entities: [
        lineEntity("rect.bottom", 0, 0, w, 0),
        lineEntity("rect.right", w, 0, w, h),
        lineEntity("rect.top", w, h, 0, h),
        lineEntity("rect.left", 0, h, 0, 0),
      ],
      constraints: [],
    },
  };
}

export function extrudeFeature(input: { name?: string; sketchFeatureId: string; depthMm: number }) {
  const depthM = mmToMeters(input.depthMm);
  const sketchFeatureId = input.sketchFeatureId.trim();
  if (!sketchFeatureId) throw new Error("extrude needs the sketch feature id from the previous sketch.");
  return {
    feature: {
      btType: "BTMFeature-134",
      featureType: "extrude",
      name: input.name?.trim() || "VantageExtrude",
      suppressed: false,
      namespace: "",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          queries: [
            {
              btType: "BTMIndividualSketchRegionQuery-140",
              filterInnerLoops: true,
              queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
              featureId: sketchFeatureId,
              deterministicIds: [],
            },
          ],
          parameterId: "entities",
        },
        {
          btType: "BTMParameterEnum-145",
          enumName: "NewBodyOperationType",
          value: "NEW",
          parameterId: "operationType",
        },
        {
          btType: "BTMParameterQuantity-147",
          isInteger: false,
          value: depthM,
          units: "",
          expression: `${input.depthMm} mm`,
          parameterId: "depth",
        },
      ],
    },
  };
}

export function parseAddedFeatureId(body: unknown): string {
  const root = body as {
    feature?: { featureId?: string; message?: { featureId?: string } };
    featureId?: string;
  };
  const id =
    root?.feature?.featureId ||
    root?.feature?.message?.featureId ||
    root?.featureId ||
    "";
  if (!id) throw new Error("Onshape did not return a feature id. Open a disposable Part Studio and try again.");
  return String(id);
}
