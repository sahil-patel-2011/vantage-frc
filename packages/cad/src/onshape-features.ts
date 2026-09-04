/**
 * Onshape Part Studio feature payloads (BTM JSON) for the tools the CAD agent can run.
 *
 * Everything here is pure: build a body for
 *   POST /partstudios/d/{did}/w/{wid}/e/{eid}/features
 * and nothing else. Units are millimetres in, metres on the wire (Onshape's
 * internal length unit), with the human `expression` kept in mm so the feature
 * reads correctly when a student opens it in the Onshape UI.
 *
 * Verified against Onshape's public feature-access documentation:
 *   btType BTFeatureDefinitionCall-1406 / BTMFeature-134 / BTMSketch-151,
 *   parameters BTMParameterQuantity-147, BTMParameterEnum-145,
 *   BTMParameterBoolean-144, BTMParameterQueryList-148 (BTMIndividualQuery-138
 *   with deterministicIds, BTMIndividualSketchRegionQuery-140),
 *   BTMParameterFeatureList-1749, and DELETE …/features/featureid/{fid}.
 *
 * Edge / face / vertex selections are never guessed: onshape-resolve.ts evaluates
 * a read-only FeatureScript lambda first and returns real deterministic ids, which
 * are then passed here.
 */

const STANDARD_PLANES: Record<string, string> = {
  Front: "JCC",
  Top: "JDC",
  Right: "JEC",
};

export const ONSHAPE_STANDARD_PLANES = ["Front", "Top", "Right"] as const;
export type OnshapeStandardPlane = (typeof ONSHAPE_STANDARD_PLANES)[number];

export function onshapePlaneId(plane: string): string {
  const name = plane.trim() || "Top";
  const id = STANDARD_PLANES[name] ?? STANDARD_PLANES[name[0]!.toUpperCase() + name.slice(1).toLowerCase()];
  if (!id) throw new Error(`Unknown sketch plane "${plane}". Use Front, Top, or Right.`);
  return id;
}

/** Unit normal of a standard plane, in Onshape world axes. Used to pick "which edges are the corners". */
export function onshapePlaneNormal(plane: string): [number, number, number] {
  const name = plane.trim() || "Top";
  const key = STANDARD_PLANES[name] ? name : name[0]!.toUpperCase() + name.slice(1).toLowerCase();
  if (key === "Top") return [0, 0, 1];
  if (key === "Front") return [0, 1, 0];
  if (key === "Right") return [1, 0, 0];
  throw new Error(`Unknown sketch plane "${plane}". Use Front, Top, or Right.`);
}

/** Positive size in mm (width, depth, radius…). */
function sizeMm(mm: number, label: string): number {
  if (!Number.isFinite(mm) || mm <= 0 || mm > 10_000) {
    throw new Error(`${label} must be a positive number of millimetres (max 10000). Got ${String(mm)}.`);
  }
  return mm / 1000;
}

/** Signed coordinate in mm (sketch point positions may be negative). */
function coordMm(mm: number, label: string): number {
  if (!Number.isFinite(mm) || Math.abs(mm) > 10_000) {
    throw new Error(`${label} must be a number of millimetres between -10000 and 10000. Got ${String(mm)}.`);
  }
  return mm / 1000;
}

function integerCount(value: number, label: string, max = 200): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 2 || n > max) {
    throw new Error(`${label} must be a whole number between 2 and ${max}. Got ${String(value)}.`);
  }
  return n;
}

function requireIds(ids: readonly string[], label: string): string[] {
  const clean = ids.map((id) => String(id ?? "").trim()).filter(Boolean);
  if (!clean.length) {
    throw new Error(
      `${label} is empty. Resolve real geometry first (onshape_describe, or the tool's own featureId argument) — Vantage never guesses Onshape entity ids.`,
    );
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

export function quantityParameter(parameterId: string, mm: number, meters: number) {
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: false,
    value: meters,
    units: "",
    expression: `${mm} mm`,
    parameterId,
  };
}

export function angleParameter(parameterId: string, degrees: number) {
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: false,
    value: (degrees * Math.PI) / 180,
    units: "",
    expression: `${degrees} deg`,
    parameterId,
  };
}

export function countParameter(parameterId: string, count: number) {
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: true,
    value: count,
    units: "",
    expression: String(count),
    parameterId,
  };
}

export function booleanParameter(parameterId: string, value: boolean) {
  return { btType: "BTMParameterBoolean-144", value, parameterId };
}

export function enumParameter(parameterId: string, enumName: string, value: string) {
  return { btType: "BTMParameterEnum-145", enumName, value, parameterId };
}

/** Query list built from deterministic ids resolved by onshape-resolve.ts. */
export function deterministicQueryParameter(parameterId: string, deterministicIds: readonly string[]) {
  return {
    btType: "BTMParameterQueryList-148",
    queries: [{ btType: "BTMIndividualQuery-138", deterministicIds: [...deterministicIds] }],
    parameterId,
  };
}

export function featureListParameter(parameterId: string, featureIds: readonly string[]) {
  return {
    btType: "BTMParameterFeatureList-1749",
    featureIds: [...featureIds],
    parameterId,
  };
}

function sketchPlaneParameter(plane: string) {
  return deterministicQueryParameter("sketchPlane", [onshapePlaneId(plane)]);
}

function featureCall<T extends Record<string, unknown>>(feature: T) {
  return { btType: "BTFeatureDefinitionCall-1406" as const, feature };
}

// ---------------------------------------------------------------------------
// Sketch entities
// ---------------------------------------------------------------------------

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

function circleEntity(id: string, cx: number, cy: number, radius: number) {
  return {
    btType: "BTMSketchCurve-4",
    entityId: id,
    centerId: `${id}.center`,
    isConstruction: false,
    geometry: {
      btType: "BTCurveGeometryCircle-115",
      radius,
      xCenter: cx,
      yCenter: cy,
      xDir: 1,
      yDir: 0,
      clockwise: false,
    },
  };
}

function pointEntity(id: string, x: number, y: number) {
  return {
    btType: "BTMSketchPoint-158",
    entityId: id,
    x,
    y,
    isConstruction: false,
  };
}

function sketchFeature(name: string, plane: string, entities: unknown[]) {
  return featureCall({
    btType: "BTMSketch-151",
    featureType: "newSketch",
    name: name.trim() || "VantageSketch",
    suppressed: false,
    parameters: [sketchPlaneParameter(plane)],
    entities,
    constraints: [],
  });
}

// ---------------------------------------------------------------------------
// Sketches
// ---------------------------------------------------------------------------

export function rectangleSketchFeature(input: {
  name?: string;
  plane?: string;
  widthMm: number;
  heightMm: number;
  /** Rectangle corner offset from the sketch origin. Defaults to the origin. */
  originXMm?: number;
  originYMm?: number;
}) {
  const w = sizeMm(input.widthMm, "widthMm");
  const h = sizeMm(input.heightMm, "heightMm");
  const x = coordMm(input.originXMm ?? 0, "originXMm");
  const y = coordMm(input.originYMm ?? 0, "originYMm");
  return sketchFeature(input.name ?? "VantageSketch", input.plane ?? "Top", [
    lineEntity("rect.bottom", x, y, x + w, y),
    lineEntity("rect.right", x + w, y, x + w, y + h),
    lineEntity("rect.top", x + w, y + h, x, y + h),
    lineEntity("rect.left", x, y + h, x, y),
  ]);
}

export type CircleSpec = { diameterMm: number; centerXMm?: number; centerYMm?: number };

/**
 * One sketch holding one or more circles. Closed regions, so the result can be
 * extruded (boss) or cut. For fastener holes prefer onshape_hole, which produces
 * a real Hole feature that a manufacturer can read off the drawing.
 */
export function circleSketchFeature(input: { name?: string; plane?: string; circles: CircleSpec[] }) {
  if (!input.circles?.length) throw new Error("Give at least one circle (diameterMm, optional centerXMm/centerYMm).");
  if (input.circles.length > 64) throw new Error("Keep a single circle sketch to 64 circles or fewer.");
  const entities = input.circles.map((circle, index) =>
    circleEntity(
      `circle.${index}`,
      coordMm(circle.centerXMm ?? 0, "centerXMm"),
      coordMm(circle.centerYMm ?? 0, "centerYMm"),
      sizeMm(circle.diameterMm, "diameterMm") / 2,
    ),
  );
  return sketchFeature(input.name ?? "VantageCircles", input.plane ?? "Top", entities);
}

export type SketchPointMm = { xMm: number; yMm: number };

function finitePointMm(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 10_000) {
    throw new Error(`${label} must be a number of millimetres between -10000 and 10000. Got ${String(value)}.`);
  }
  return number;
}

function oneSketchPointMm(item: unknown, index: number): SketchPointMm {
  if (Array.isArray(item) && item.length >= 2) {
    return {
      xMm: finitePointMm(item[0], `points[${index}].xMm`),
      yMm: finitePointMm(item[1], `points[${index}].yMm`),
    };
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return {
      xMm: finitePointMm(record.xMm ?? record.x, `points[${index}].xMm`),
      yMm: finitePointMm(record.yMm ?? record.y, `points[${index}].yMm`),
    };
  }
  if (typeof item === "string") {
    const nums = item.trim().split(/[,\s]+/).filter(Boolean);
    if (nums.length < 2) throw new Error(`Point ${index + 1} needs xMm and yMm in millimetres.`);
    return {
      xMm: finitePointMm(nums[0], `points[${index}].xMm`),
      yMm: finitePointMm(nums[1], `points[${index}].yMm`),
    };
  }
  throw new Error(`Point ${index + 1} needs xMm and yMm in millimetres.`);
}

/**
 * Human or tool points: `[{xMm,yMm}]`, `[[x,y]]`, or `0,0; 80,0; 80,40`.
 * Empty stays empty — this never invents corners.
 */
export function parseSketchPointsMm(value: unknown): SketchPointMm[] {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error("Points JSON is invalid. Use millimetre pairs like 0,0; 80,0; 80,40.");
      }
      return parseSketchPointsMm(parsed);
    }
    return trimmed
      .split(/[;|\n]+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk, index) => oneSketchPointMm(chunk, index));
  }
  if (!Array.isArray(value)) {
    throw new Error("Points must be millimetre pairs like 0,0; 80,0; 80,40.");
  }
  return value.map((item, index) => oneSketchPointMm(item, index));
}

/** Sketch of bare points — the `locations` input a Hole feature drills at. */
export function pointsSketchFeature(input: { name?: string; plane?: string; points: SketchPointMm[] }) {
  if (!input.points?.length) throw new Error("Give at least one point (xMm, yMm).");
  if (input.points.length > 128) throw new Error("Keep a single point sketch to 128 points or fewer.");
  const entities = input.points.map((point, index) =>
    pointEntity(`point.${index}`, coordMm(point.xMm, "xMm"), coordMm(point.yMm, "yMm")),
  );
  return sketchFeature(input.name ?? "VantageHolePoints", input.plane ?? "Top", entities);
}

/**
 * Open polyline or closed polygon from explicit mm points. A closed polyline is a
 * region and can be extruded; an open one is a path only.
 */
export function polylineSketchFeature(input: {
  name?: string;
  plane?: string;
  points: SketchPointMm[];
  closed?: boolean;
}) {
  const points = input.points ?? [];
  if (points.length < 2) throw new Error("A polyline needs at least 2 points (xMm, yMm).");
  if (points.length > 128) throw new Error("Keep a polyline to 128 points or fewer.");
  const xy = points.map((point, index) => ({
    x: coordMm(point.xMm, `points[${index}].xMm`),
    y: coordMm(point.yMm, `points[${index}].yMm`),
  }));
  const segments: unknown[] = [];
  const last = input.closed ? xy.length : xy.length - 1;
  for (let i = 0; i < last; i++) {
    const a = xy[i]!;
    const b = xy[(i + 1) % xy.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) {
      throw new Error(`Polyline points ${i + 1} and ${i + 2} are the same point — remove the duplicate.`);
    }
    segments.push(lineEntity(`poly.${i}`, a.x, a.y, b.x, b.y));
  }
  return sketchFeature(input.name ?? "VantagePolyline", input.plane ?? "Top", segments);
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

export const EXTRUDE_OPERATIONS = ["NEW", "ADD", "REMOVE", "INTERSECT"] as const;
export type ExtrudeOperation = (typeof EXTRUDE_OPERATIONS)[number];

export function extrudeFeature(input: {
  name?: string;
  sketchFeatureId: string;
  depthMm: number;
  /** NEW makes a body, REMOVE cuts, ADD merges into the existing solid. */
  operationType?: ExtrudeOperation;
  oppositeDirection?: boolean;
}) {
  const depthM = sizeMm(input.depthMm, "depthMm");
  const sketchFeatureId = input.sketchFeatureId.trim();
  if (!sketchFeatureId) throw new Error("extrude needs the sketch feature id from the previous sketch.");
  const operationType = input.operationType ?? "NEW";
  if (!(EXTRUDE_OPERATIONS as readonly string[]).includes(operationType)) {
    throw new Error(`operationType must be one of ${EXTRUDE_OPERATIONS.join(", ")}.`);
  }
  const parameters: unknown[] = [
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
    enumParameter("operationType", "NewBodyOperationType", operationType),
    quantityParameter("depth", input.depthMm, depthM),
  ];
  if (input.oppositeDirection) parameters.push(booleanParameter("oppositeDirection", true));
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "extrude",
    name: input.name?.trim() || "VantageExtrude",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

export function revolveFeature(input: {
  name?: string;
  sketchFeatureId: string;
  axisIds: readonly string[];
  angleDeg?: number;
  operationType?: ExtrudeOperation;
  oppositeDirection?: boolean;
}) {
  const sketchFeatureId = input.sketchFeatureId.trim();
  if (!sketchFeatureId) throw new Error("revolve needs the sketch feature id from the previous sketch.");
  const axisIds = requireIds(input.axisIds, "axisIds");
  const operationType = input.operationType ?? "NEW";
  if (!(EXTRUDE_OPERATIONS as readonly string[]).includes(operationType)) {
    throw new Error(`operationType must be one of ${EXTRUDE_OPERATIONS.join(", ")}.`);
  }
  const angleDeg = input.angleDeg ?? 360;
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg > 360) {
    throw new Error(`Revolve angle must be a positive number of degrees (max 360). Got ${String(input.angleDeg)}.`);
  }
  const parameters: unknown[] = [
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
    deterministicQueryParameter("axis", axisIds),
    enumParameter("operationType", "NewBodyOperationType", operationType),
    angleParameter("angle", angleDeg),
  ];
  if (input.oppositeDirection) parameters.push(booleanParameter("oppositeDirection", true));
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "revolve",
    name: input.name?.trim() || "VantageRevolve",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

export const BOOLEAN_OPERATIONS = ["UNION", "SUBTRACT", "INTERSECT"] as const;
export type BooleanOperation = (typeof BOOLEAN_OPERATIONS)[number];

export function booleanFeature(input: {
  name?: string;
  operationType: BooleanOperation;
  toolBodyIds: readonly string[];
  targetBodyIds?: readonly string[];
}) {
  const tools = requireIds(input.toolBodyIds, "toolBodyIds");
  const operationType = input.operationType;
  if (!(BOOLEAN_OPERATIONS as readonly string[]).includes(operationType)) {
    throw new Error(`boolean operationType must be one of ${BOOLEAN_OPERATIONS.join(", ")}.`);
  }
  const parameters: unknown[] = [
    enumParameter("operationType", "BooleanOperationType", operationType),
    deterministicQueryParameter("tools", tools),
  ];
  if (operationType !== "UNION" || (input.targetBodyIds?.length ?? 0) > 0) {
    parameters.push(deterministicQueryParameter("targets", requireIds(input.targetBodyIds ?? [], "targetBodyIds")));
  }
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "boolean",
    name: input.name?.trim() || "VantageBoolean",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

/**
 * Constant-radius edge fillet. `edgeIds` are deterministic ids from
 * resolveOnshapeEdgeIds — only `entities` and `radius` are sent so Onshape keeps
 * its own defaults for cross-section and tangent propagation.
 */
export function filletFeature(input: { name?: string; edgeIds: readonly string[]; radiusMm: number }) {
  const radius = sizeMm(input.radiusMm, "radiusMm");
  const edges = requireIds(input.edgeIds, "edgeIds");
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "fillet",
    name: input.name?.trim() || "VantageFillet",
    suppressed: false,
    namespace: "",
    parameters: [
      deterministicQueryParameter("entities", edges),
      quantityParameter("radius", input.radiusMm, radius),
    ],
  });
}

/** Equal-offset chamfer. `width` is the leg length in mm. */
export function chamferFeature(input: { name?: string; edgeIds: readonly string[]; widthMm: number }) {
  const width = sizeMm(input.widthMm, "widthMm");
  const edges = requireIds(input.edgeIds, "edgeIds");
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "chamfer",
    name: input.name?.trim() || "VantageChamfer",
    suppressed: false,
    namespace: "",
    parameters: [
      deterministicQueryParameter("entities", edges),
      quantityParameter("width", input.widthMm, width),
    ],
  });
}

/**
 * Hollow a solid, removing the named faces.
 *
 * `faceIds` are the faces to open, resolved by onshape-resolve — an empty list
 * would shell every face into a closed void, so it is refused rather than guessed.
 * Thickness goes inward unless `outward` is set, which matches Onshape's own
 * default and keeps the part inside its original bounding box.
 */
export function shellFeature(input: {
  name?: string;
  faceIds: readonly string[];
  thicknessMm: number;
  outward?: boolean;
}) {
  const thickness = sizeMm(input.thicknessMm, "thicknessMm");
  const faces = requireIds(input.faceIds, "faceIds");
  const parameters: unknown[] = [
    deterministicQueryParameter("entities", faces),
    quantityParameter("thickness", input.thicknessMm, thickness),
  ];
  if (input.outward) parameters.push(booleanParameter("oppositeDirection", true));
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "shell",
    name: input.name?.trim() || "VantageShell",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

export const HOLE_END_STYLES = ["THROUGH", "BLIND"] as const;
export type HoleEndStyle = (typeof HOLE_END_STYLES)[number];

/**
 * Simple drilled hole at sketch points.
 *
 * `locationIds` are the deterministic vertex ids of a point sketch (resolve them
 * with resolveOnshapeVertexIds against the point-sketch feature id); `scopeIds`
 * are the solid bodies to drill. Both are real geometry, never guessed.
 */
export function holeFeature(input: {
  name?: string;
  locationIds: readonly string[];
  scopeIds: readonly string[];
  diameterMm: number;
  endStyle?: HoleEndStyle;
  depthMm?: number;
}) {
  const diameter = sizeMm(input.diameterMm, "diameterMm");
  const locations = requireIds(input.locationIds, "locationIds");
  const scope = requireIds(input.scopeIds, "scopeIds");
  const endStyle = input.endStyle ?? "THROUGH";
  if (!(HOLE_END_STYLES as readonly string[]).includes(endStyle)) {
    throw new Error(`endStyle must be one of ${HOLE_END_STYLES.join(", ")}.`);
  }
  const parameters: unknown[] = [
    enumParameter("style", "HoleStyle", "SIMPLE"),
    enumParameter("endStyle", "HoleEndStyle", endStyle),
    quantityParameter("holeDiameter", input.diameterMm, diameter),
    deterministicQueryParameter("locations", locations),
    deterministicQueryParameter("scope", scope),
  ];
  if (endStyle === "BLIND") {
    const depthMm = input.depthMm;
    if (depthMm === undefined) throw new Error("A BLIND hole needs depthMm. Use THROUGH to drill all the way.");
    parameters.push(quantityParameter("holeDepth", depthMm, sizeMm(depthMm, "depthMm")));
  }
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "hole",
    name: input.name?.trim() || "VantageHole",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

export const PATTERN_AXES = ["X", "Y", "Z"] as const;
export type PatternAxis = (typeof PATTERN_AXES)[number];

/**
 * Deterministic id whose normal is the requested world axis. Onshape's
 * `directionOne` accepts a planar face, so the standard planes give an exact,
 * explainable pattern direction without resolving a stray edge.
 */
export function patternAxisPlaneId(axis: string): string {
  const key = String(axis ?? "X").trim().toUpperCase();
  if (key === "X") return onshapePlaneId("Right");
  if (key === "Y") return onshapePlaneId("Front");
  if (key === "Z") return onshapePlaneId("Top");
  throw new Error(`direction must be one of ${PATTERN_AXES.join(", ")}. Got "${axis}".`);
}

/**
 * Linear pattern of whole features (the FRC case: repeat a hole or a cut).
 * `directionIds` is one planar face or straight edge setting the direction —
 * patternAxisPlaneId() turns "X"/"Y"/"Z" into exactly that.
 */
export function linearPatternFeature(input: {
  name?: string;
  featureIds: readonly string[];
  directionIds: readonly string[];
  spacingMm: number;
  instanceCount: number;
  oppositeDirection?: boolean;
}) {
  const spacing = sizeMm(input.spacingMm, "spacingMm");
  const features = requireIds(input.featureIds, "featureIds");
  const direction = requireIds(input.directionIds, "directionIds");
  const count = integerCount(input.instanceCount, "instanceCount");
  const parameters: unknown[] = [
    enumParameter("patternType", "PatternType", "FEATURE"),
    featureListParameter("instanceFunction", features),
    deterministicQueryParameter("directionOne", direction),
    quantityParameter("distance", input.spacingMm, spacing),
    countParameter("instanceCount", count),
  ];
  if (input.oppositeDirection) parameters.push(booleanParameter("oppositeDirection", true));
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "linearPattern",
    name: input.name?.trim() || "VantageLinearPattern",
    suppressed: false,
    namespace: "",
    parameters,
  });
}

/** Circular pattern of whole features about a cylindrical face / axis. */
export function circularPatternFeature(input: {
  name?: string;
  featureIds: readonly string[];
  axisIds: readonly string[];
  instanceCount: number;
  angleDeg?: number;
  equalSpacing?: boolean;
}) {
  const features = requireIds(input.featureIds, "featureIds");
  const axis = requireIds(input.axisIds, "axisIds");
  const count = integerCount(input.instanceCount, "instanceCount");
  const angleDeg = input.angleDeg ?? 360;
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg > 360) {
    throw new Error("angleDeg must be greater than 0 and at most 360.");
  }
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "circularPattern",
    name: input.name?.trim() || "VantageCircularPattern",
    suppressed: false,
    namespace: "",
    parameters: [
      enumParameter("patternType", "PatternType", "FEATURE"),
      featureListParameter("instanceFunction", features),
      deterministicQueryParameter("axis", axis),
      countParameter("instanceCount", count),
      angleParameter("angle", angleDeg),
      booleanParameter("equalSpacing", input.equalSpacing ?? true),
    ],
  });
}

/** Mirror features across a standard plane (Front/Top/Right) — fully deterministic. */
export function mirrorFeature(input: { name?: string; featureIds: readonly string[]; plane?: string; planeIds?: readonly string[] }) {
  const features = requireIds(input.featureIds, "featureIds");
  const planeIds = input.planeIds?.length ? requireIds(input.planeIds, "planeIds") : [onshapePlaneId(input.plane ?? "Right")];
  return featureCall({
    btType: "BTMFeature-134",
    featureType: "mirror",
    name: input.name?.trim() || "VantageMirror",
    suppressed: false,
    namespace: "",
    parameters: [
      enumParameter("patternType", "MirrorType", "FEATURE"),
      featureListParameter("instanceFunction", features),
      deterministicQueryParameter("mirrorPlane", planeIds),
    ],
  });
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

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

/** Path for DELETE …/features/featureid/{fid} (feature-level undo). */
export function onshapeFeaturePath(
  document: { documentId: string; workspaceId: string; elementId: string },
  featureId?: string,
): string {
  const base = `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}/features`;
  return featureId ? `${base}/featureid/${encodeURIComponent(featureId)}` : base;
}

// ---------------------------------------------------------------------------
// Custom features — one generated FeatureScript feature builds the whole solid
// ---------------------------------------------------------------------------

/**
 * Onshape's feature JSON carries a `serializationVersion`. Keep this in step with
 * FS_SERIALIZATION_VERSION in onshape-resolve.ts — they describe the same wire
 * format, and Onshape rejects a body whose version it does not recognise.
 */
export const ONSHAPE_SERIALIZATION_VERSION = "1.1.22";

export type FeatureStudioReference = {
  /** Element id of the Feature Studio holding the generated source. */
  elementId: string;
  /** Microversion of that Feature Studio — read it back after writing the contents. */
  microversionId: string;
  /** Only for a Feature Studio in a DIFFERENT document than the Part Studio. */
  documentId?: string;
  /** Only for a cross-document reference, and only a released version. */
  versionId?: string;
};

function onshapeToken(value: string, label: string): string {
  const token = String(value ?? "").trim();
  // Onshape ids are opaque alphanumeric tokens (24 hex characters in practice).
  if (!/^[A-Za-z0-9]{8,40}$/.test(token)) {
    throw new Error(`${label} must be an Onshape id. Got "${token}".`);
  }
  return token;
}

/**
 * Namespace string that points a BTMFeature-134 at a custom feature.
 *
 * Standard features have no namespace; a custom feature's namespace names the
 * Feature Studio it was written in. The same-document form is
 * `e{elementId}::m{microversionId}` — the shape seen in two independent working
 * API bodies, `"e548d56ece749371a5a6ad6ec::m3e236759fa16868e79d8699e"`
 * (https://forum.onshape.com/discussion/26720/how-to-use-the-api-to-execute-a-featurescript-to-create-a-custom-feature)
 * and `"e03fd799aee4796bff7177d98::m4c232d7c5b8456deef0ccc33"`
 * (https://forum.onshape.com/discussion/13148/regarding-addfeature-api).
 * A cross-document reference prefixes the document and version
 * (https://forum.onshape.com/discussion/18560/how-do-i-add-a-custom-feature-i-wrote-in-featurescript-to-my-partstudio-using-the-api).
 *
 * Onshape does not publish this format in its reference documentation, so the
 * safe confirmation is a single GET …/features after one manual insert: the
 * object it returns is the object the add endpoint accepts.
 */
export function customFeatureNamespace(reference: FeatureStudioReference): string {
  const elementId = onshapeToken(reference.elementId, "featureStudio.elementId");
  const microversionId = onshapeToken(reference.microversionId, "featureStudio.microversionId");
  const local = `e${elementId}::m${microversionId}`;
  if (!reference.documentId && !reference.versionId) return local;
  if (!reference.documentId || !reference.versionId) {
    throw new Error("A cross-document custom feature needs BOTH documentId and versionId. Release a version of the Feature Studio first.");
  }
  return `d${onshapeToken(reference.documentId, "featureStudio.documentId")}::v${onshapeToken(reference.versionId, "featureStudio.versionId")}::${local}`;
}

/** Path for the Feature Studio contents endpoints (GET to read, POST to write). */
export function onshapeFeatureStudioPath(
  document: { documentId: string; workspaceId: string },
  elementId?: string,
): string {
  const base = `/featurestudios/d/${document.documentId}/w/${document.workspaceId}`;
  return elementId ? `${base}/e/${encodeURIComponent(elementId)}` : base;
}

/**
 * Body for writing generated FeatureScript into a Feature Studio.
 *
 * `sourceMicroversion` + `rejectMicroversionSkew` are the optimistic-concurrency
 * pair: pass the microversion the source was read at and Onshape refuses the
 * write if somebody edited the Studio in between, rather than silently
 * clobbering a student's manual edit.
 */
export function featureStudioContentsPayload(input: {
  source: string;
  sourceMicroversion?: string;
  rejectMicroversionSkew?: boolean;
  serializationVersion?: string;
}) {
  const contents = String(input.source ?? "");
  if (!contents.trim()) throw new Error("Refusing to write an empty Feature Studio. Generate the part FeatureScript first.");
  if (contents.length > 20_000) {
    throw new Error(
      `This FeatureScript is ${contents.length.toLocaleString("en-US")} characters, over the 20,000-character limit Vantage enforces on generated source.`,
    );
  }
  return {
    contents,
    serializationVersion: input.serializationVersion ?? ONSHAPE_SERIALIZATION_VERSION,
    ...(input.sourceMicroversion ? { sourceMicroversion: input.sourceMicroversion } : {}),
    rejectMicroversionSkew: input.rejectMicroversionSkew ?? false,
  };
}

/** Microversion of a Feature Studio, from a GET/POST contents response. */
export function parseFeatureStudioMicroversion(body: unknown): string {
  const root = (body ?? {}) as Record<string, unknown>;
  const id = String(root.microversionId ?? root.sourceMicroversion ?? "");
  if (!id) {
    throw new Error(
      "Onshape did not return a Feature Studio microversion, so the custom-feature namespace cannot be built. Re-read the Feature Studio contents and try again.",
    );
  }
  return id;
}

/** One generated parameter, in the shape the mm-value/expression pair implies. */
export type GeneratedFeatureParameter = {
  parameterId: string;
  kind: "length" | "count" | "angle";
  value: number;
};

function generatedParameterPayload(parameter: GeneratedFeatureParameter) {
  const parameterId = String(parameter.parameterId ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(parameterId)) {
    throw new Error(`"${parameterId}" is not a FeatureScript parameter id emitted by the part generator.`);
  }
  const value = Number(parameter.value);
  if (!Number.isFinite(value)) throw new Error(`Parameter "${parameterId}" has a non-numeric value.`);
  if (parameter.kind === "count") return countParameter(parameterId, Math.round(value));
  if (parameter.kind === "angle") return angleParameter(parameterId, value);
  // Lengths may be negative here (pattern start/step offsets), so this cannot use
  // sizeMm(); the mm-to-metre conversion is the same one every other feature uses.
  if (Math.abs(value) > 10_000) {
    throw new Error(`Parameter "${parameterId}" is ${value} mm, outside the ±10000 mm range Vantage models.`);
  }
  return quantityParameter(parameterId, value, value / 1000);
}

/**
 * The single addFeature body that builds a whole generated part.
 *
 * `featureType` is the exported FeatureScript const name; `namespace` points at
 * the Feature Studio it lives in. Everything the user might later change is a
 * parameter here, which is what makes the edit path cheap.
 */
export function customFeatureCall(input: {
  featureType: string;
  namespace: string;
  name?: string;
  parameters: readonly GeneratedFeatureParameter[];
}) {
  const featureType = String(input.featureType ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(featureType)) {
    throw new Error(`"${featureType}" is not a FeatureScript feature type name. Use the featureTypeId from the generator.`);
  }
  const namespace = String(input.namespace ?? "").trim();
  if (!namespace.includes("::")) {
    throw new Error("A custom feature needs the Feature Studio namespace. Build it with customFeatureNamespace().");
  }
  return featureCall({
    btType: "BTMFeature-134",
    featureType,
    namespace,
    name: input.name?.trim() || featureType,
    suppressed: false,
    parameters: input.parameters.map(generatedParameterPayload),
    subFeatures: [],
    returnAfterSubfeatures: false,
  });
}

/**
 * Update an EXISTING generated feature in place — the whole point of making every
 * dimension a named parameter. "Make it 8 mm instead of 6" is this one call:
 * POST …/features/featureid/{fid} with the same featureType and namespace and the
 * new parameter values. No regenerated source, no re-inserted geometry, no lost
 * downstream references.
 */
export function customFeatureUpdateCall(input: {
  featureId: string;
  featureType: string;
  namespace: string;
  name?: string;
  parameters: readonly GeneratedFeatureParameter[];
}) {
  const featureId = String(input.featureId ?? "").trim();
  if (!featureId) throw new Error("Updating a feature needs the featureId Onshape returned when it was inserted.");
  const call = customFeatureCall(input);
  return { ...call, feature: { ...call.feature, featureId } };
}

// The generator lives in ./featurescript; re-exported here so `@vantage/cad`
// exposes it through the same barrel as the feature payloads it feeds.
export * from "./featurescript";
