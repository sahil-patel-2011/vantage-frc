/**
 * Turn a PartDefinition into ONE Onshape custom feature.
 *
 * Why one feature: Onshape's annual API-key quota is small, and a
 * sketch -> extrude -> resolve -> fillet -> resolve -> hole loop spends one call
 * per operation. A single custom feature that builds the whole solid costs one
 * insert regardless of how many holes, ribs and fillets the part has.
 *
 * FeatureScript facts this generator relies on, each verified against Onshape's
 * own documentation (URLs cited beside the construct that uses them):
 *
 *  - Feature declaration shape — `annotation { "Feature Type Name" : … }` +
 *    `export const x = defineFeature(function(context is Context, id is Id,
 *    definition is map) precondition { … } { … });`
 *    https://cad.onshape.com/FsDoc/feature-types.html
 *  - Precondition parameter syntax — `isLength(definition.x, LENGTH_BOUNDS);`,
 *    `isAngle(definition.x, ANGLE_360_BOUNDS);`,
 *    `isInteger(definition.x, POSITIVE_COUNT_BOUNDS);`
 *    https://cad.onshape.com/FsDoc/uispec.html
 *  - Operation signatures and map keys — opExtrude / opFillet (entities, radius) /
 *    opChamfer (entities, chamferType, width) / opBoolean (tools, targets,
 *    operationType) are all `(context is Context, id is Id, definition is map)`
 *    https://cad.onshape.com/FsDoc/library.html
 *  - `qCreatedBy` returns entities CREATED by an id (not entities merely modified
 *    by a later boolean), and `qOwnedByBody(bodyQuery, EntityType.EDGE)` walks a
 *    body's edges — https://cad.onshape.com/FsDoc/library.html
 *
 * The `FeatureScript <n>;` header is a LANGUAGE version, and Onshape deliberately
 * never upgrades it under an existing part: "versions can't be changed and will be
 * at the old version forever", and Onshape "does not update or allow updating of
 * the FeatureScript version of versioned Part Studios" so a behaviour change can
 * never destroy a model (https://forum.onshape.com/discussion/27625/featurescript-versions).
 * Pinning is therefore the correct choice, not a shortcut — see
 * DEFAULT_FEATURESCRIPT_VERSION below for what the pinned number is and is not.
 */

import {
  clonePartDefinition,
  coordinateMm,
  expressionFor,
  featureScriptToken,
  FEATURESCRIPT_SOURCE_LIMIT,
  fsMillimetres,
  positiveMm,
  setDefinitionPath,
  wholeCount,
  type BossSpec,
  type EdgeTreatmentSpec,
  type FeatureScriptParameter,
  type FeatureScriptParameterKind,
  type HoleSpec,
  type PartBase,
  type PartDefinition,
  type PocketSpec,
  type Point2Mm,
  type RibSpec,
  type SourceBudgetSection,
} from "./part-schema";

/**
 * FeatureScript language / standard-library version written into the generated
 * header and the `import(… version : "<n>.0")` line.
 *
 * 2144 is the value Onshape's own public API documentation uses in its worked
 * `libraryVersion` example (https://onshape-public.github.io/docs/api-adv/fs/).
 * It is NOT a claim about the newest release — Onshape does not publish a
 * "current version" endpoint in that documentation, and the number moves with
 * every release (a community example shows an import at "2641.0":
 * https://forum.onshape.com/discussion/22465/how-do-i-update-the-featurescript-version-of-a-tab-in-a-document).
 * Callers that read a real version off their own account should pass it through
 * `options.featureScriptVersion`; pinning an older language version is safe by
 * design because old versions keep working, but a version older than a std
 * function's introduction will fail to compile in Onshape, which surfaces as a
 * FeatureScript error rather than as wrong geometry.
 */
export const DEFAULT_FEATURESCRIPT_VERSION = 2144;

/**
 * Cut tools are extended past the face they break through so the boolean is a
 * clean subtraction rather than a coincident-face intersection. This is a
 * modelling epsilon, not a manufacturing tolerance — it never changes the
 * modelled hole diameter or depth.
 */
const CUT_OVERSHOOT_MM = 0.5;

export type GenerateOptions = {
  featureScriptVersion?: number;
  /** Override the 20,000-character ceiling only to test the guard. */
  sourceLimit?: number;
};

export type GeneratedIdBinding = {
  /** Stable token the agent, the spatial report and the DFM pass refer to. */
  token: string;
  /** Sub-id path appended to the inserted feature's id inside the Part Studio. */
  subIds: string[];
  entityType: "BODY" | "FACE" | "EDGE";
  description: string;
  /**
   * True when the last sub-id is a loop index. The naming RULE is stable across
   * rebuilds (prefix + decimal index); the number of instances follows the count
   * parameter, so a count edit adds or removes instances without renaming any.
   */
  indexed: boolean;
};

export type PredictedHole = {
  holeId: string;
  index: number;
  xMm: number;
  yMm: number;
  diameterMm: number;
  through: boolean;
  depthMm: number | null;
  counterboreDiameterMm: number | null;
  counterboreDepthMm: number | null;
};

export type PredictedGeometry = {
  boundingBoxMm: { minXMm: number; minYMm: number; minZMm: number; maxXMm: number; maxYMm: number; maxZMm: number };
  sizeMm: { xMm: number; yMm: number; zMm: number };
  holes: PredictedHole[];
  /** Solid bodies the feature is expected to leave behind. */
  bodyCount: number;
  /** Arithmetic estimate only. `volumeCaveats` says exactly what it ignores. */
  approxSolidVolumeMm3: number;
  volumeCaveats: string[];
};

export type GeneratedPartFeature = {
  /** "Feature Type Name" in the Onshape dialog. */
  featureTypeName: string;
  /** Exported FeatureScript const, and the `featureType` of the inserted BTMFeature-134. */
  featureTypeId: string;
  featureScriptVersion: number;
  source: string;
  parameters: FeatureScriptParameter[];
  ids: GeneratedIdBinding[];
  geometry: PredictedGeometry;
  warnings: string[];
  sourceBudget: { limit: number; used: number; sections: SourceBudgetSection[] };
  /** The definition the source was generated from, cloned so callers cannot mutate it. */
  definition: PartDefinition;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

type PendingSection = { label: string; lines: string[] };

class PartBuilder {
  readonly parameters: FeatureScriptParameter[] = [];
  readonly ids: GeneratedIdBinding[] = [];
  readonly warnings: string[] = [];
  readonly sections: PendingSection[] = [];
  private readonly usedParameterIds = new Set<string>();
  private readonly usedTokens = new Set<string>();
  needsVerticalEdgeHelper = false;

  section(label: string): PendingSection {
    const section: PendingSection = { label, lines: [] };
    this.sections.push(section);
    return section;
  }

  claimToken(raw: string, label: string): string {
    const token = featureScriptToken(raw, label);
    if (this.usedTokens.has(token)) {
      throw new Error(`Two parts of this definition both resolve to the id "${token}" (${label}). Give them distinct ids.`);
    }
    this.usedTokens.add(token);
    return token;
  }

  param(input: {
    parameterId: string;
    label: string;
    kind: FeatureScriptParameterKind;
    value: number;
    path: string;
    minimum: number;
    maximum: number;
  }): string {
    if (this.usedParameterIds.has(input.parameterId)) {
      throw new Error(`Duplicate FeatureScript parameter "${input.parameterId}". Give the offending feature a distinct id.`);
    }
    this.usedParameterIds.add(input.parameterId);
    this.parameters.push({
      parameterId: input.parameterId,
      label: input.label,
      kind: input.kind,
      value: input.value,
      expression: expressionFor(input.kind, input.value),
      path: input.path,
      minimum: input.minimum,
      maximum: input.maximum,
    });
    return `definition.${input.parameterId}`;
  }

  length(parameterId: string, label: string, valueMm: number, path: string, minimum = 0.01, maximum = 10_000): string {
    return this.param({ parameterId, label, kind: "length", value: valueMm, path, minimum, maximum });
  }

  count(parameterId: string, label: string, value: number, path: string, minimum = 1, maximum = 400): string {
    return this.param({ parameterId, label, kind: "count", value, path, minimum, maximum });
  }

  angle(parameterId: string, label: string, degrees: number, path: string): string {
    return this.param({ parameterId, label, kind: "angle", value: degrees, path, minimum: 0, maximum: 360 });
  }

  bind(binding: GeneratedIdBinding): void {
    this.ids.push(binding);
  }
}

// ---------------------------------------------------------------------------
// Base shapes
// ---------------------------------------------------------------------------

type BaseFrame = {
  /** FeatureScript expression for the Z of the top face the holes/ribs sit on. */
  topZ: string;
  /** Footprint half-extent expressions, when the base has a rectangular footprint. */
  halfWidth: string | null;
  halfDepth: string | null;
  boundingBoxMm: PredictedGeometry["boundingBoxMm"];
  volumeMm3: number;
  topFaceZMm: number;
};

function emitBase(builder: PartBuilder, base: PartBase): BaseFrame {
  const section = builder.section("base");
  builder.bind({
    token: "base",
    subIds: ["base"],
    entityType: "BODY",
    description: "The solid body every later operation adds to or cuts from.",
    indexed: false,
  });

  if (base.kind === "plate") {
    const w = positiveMm(base.widthMm, "base.widthMm");
    const d = positiveMm(base.depthMm, "base.depthMm");
    const t = positiveMm(base.thicknessMm, "base.thicknessMm");
    const wExpr = builder.length("baseWidth", "Width", w, "base.widthMm");
    const dExpr = builder.length("baseDepth", "Depth", d, "base.depthMm");
    const tExpr = builder.length("baseThickness", "Thickness", t, "base.thicknessMm");
    section.lines.push(
      `    fCuboid(context, id + "base", {`,
      `            "corner1" : vector(-${wExpr} / 2, -${dExpr} / 2, 0 * millimeter),`,
      `            "corner2" : vector(${wExpr} / 2, ${dExpr} / 2, ${tExpr})`,
      `    });`,
      `    var partBody = qCreatedBy(id + "base", EntityType.BODY);`,
    );
    return {
      topZ: tExpr,
      halfWidth: `${wExpr} / 2`,
      halfDepth: `${dExpr} / 2`,
      boundingBoxMm: { minXMm: -w / 2, minYMm: -d / 2, minZMm: 0, maxXMm: w / 2, maxYMm: d / 2, maxZMm: t },
      volumeMm3: w * d * t,
      topFaceZMm: t,
    };
  }

  if (base.kind === "box") {
    const w = positiveMm(base.widthMm, "base.widthMm");
    const d = positiveMm(base.depthMm, "base.depthMm");
    const h = positiveMm(base.heightMm, "base.heightMm");
    const wExpr = builder.length("baseWidth", "Width", w, "base.widthMm");
    const dExpr = builder.length("baseDepth", "Depth", d, "base.depthMm");
    const hExpr = builder.length("baseHeight", "Height", h, "base.heightMm");
    section.lines.push(
      `    fCuboid(context, id + "base", {`,
      `            "corner1" : vector(-${wExpr} / 2, -${dExpr} / 2, 0 * millimeter),`,
      `            "corner2" : vector(${wExpr} / 2, ${dExpr} / 2, ${hExpr})`,
      `    });`,
      `    var partBody = qCreatedBy(id + "base", EntityType.BODY);`,
    );
    let volume = w * d * h;
    if (base.wallMm !== undefined) {
      const wall = positiveMm(base.wallMm, "base.wallMm");
      const floor = positiveMm(base.floorMm ?? base.wallMm, "base.floorMm");
      if (2 * wall >= w || 2 * wall >= d) {
        throw new Error(`base.wallMm (${wall} mm) leaves no cavity in a ${w} x ${d} mm box.`);
      }
      const openTop = base.openTop !== false;
      const cavityTopMm = openTop ? h : h - wall;
      if (cavityTopMm <= floor) {
        throw new Error(`base.floorMm (${floor} mm) plus the top wall leaves no cavity in a ${h} mm tall box.`);
      }
      const wallExpr = builder.length("baseWall", "Wall thickness", wall, "base.wallMm");
      const floorExpr = builder.length("baseFloor", "Floor thickness", floor, "base.floorMm");
      const cavityTopExpr = openTop ? `${hExpr} + ${fsMillimetres(CUT_OVERSHOOT_MM)}` : `${hExpr} - ${wallExpr}`;
      section.lines.push(
        `    fCuboid(context, id + "cavity", {`,
        `            "corner1" : vector(-${wExpr} / 2 + ${wallExpr}, -${dExpr} / 2 + ${wallExpr}, ${floorExpr}),`,
        `            "corner2" : vector(${wExpr} / 2 - ${wallExpr}, ${dExpr} / 2 - ${wallExpr}, ${cavityTopExpr})`,
        `    });`,
        `    opBoolean(context, id + "hollow", {`,
        `            "tools" : qCreatedBy(id + "cavity", EntityType.BODY),`,
        `            "targets" : partBody,`,
        `            "operationType" : BooleanOperationType.SUBTRACTION`,
        `    });`,
      );
      volume -= (w - 2 * wall) * (d - 2 * wall) * (cavityTopMm - floor);
    }
    return {
      topZ: hExpr,
      halfWidth: `${wExpr} / 2`,
      halfDepth: `${dExpr} / 2`,
      boundingBoxMm: { minXMm: -w / 2, minYMm: -d / 2, minZMm: 0, maxXMm: w / 2, maxYMm: d / 2, maxZMm: h },
      volumeMm3: volume,
      topFaceZMm: h,
    };
  }

  const w = positiveMm(base.widthMm, "base.widthMm");
  const legA = positiveMm(base.legAMm, "base.legAMm");
  const legB = positiveMm(base.legBMm, "base.legBMm");
  const t = positiveMm(base.thicknessMm, "base.thicknessMm");
  if (t >= legA || t >= legB) {
    throw new Error(`base.thicknessMm (${t} mm) must be smaller than both bracket legs (${legA} mm, ${legB} mm).`);
  }
  const wExpr = builder.length("baseWidth", "Width", w, "base.widthMm");
  const aExpr = builder.length("baseLegA", "Flat leg length", legA, "base.legAMm");
  const bExpr = builder.length("baseLegB", "Upright leg height", legB, "base.legBMm");
  const tExpr = builder.length("baseThickness", "Thickness", t, "base.thicknessMm");
  section.lines.push(
    `    fCuboid(context, id + "base", {`,
    `            "corner1" : vector(-${wExpr} / 2, 0 * millimeter, 0 * millimeter),`,
    `            "corner2" : vector(${wExpr} / 2, ${aExpr}, ${tExpr})`,
    `    });`,
    `    var partBody = qCreatedBy(id + "base", EntityType.BODY);`,
    `    fCuboid(context, id + "upright", {`,
    `            "corner1" : vector(-${wExpr} / 2, 0 * millimeter, 0 * millimeter),`,
    `            "corner2" : vector(${wExpr} / 2, ${tExpr}, ${bExpr})`,
    `    });`,
    `    opBoolean(context, id + "bracketJoin", {`,
    `            "tools" : qCreatedBy(id + "upright", EntityType.BODY),`,
    `            "targets" : partBody,`,
    `            "operationType" : BooleanOperationType.UNION`,
    `    });`,
  );
  builder.bind({
    token: "base.upright",
    subIds: ["upright"],
    entityType: "BODY",
    description: "Upright bracket leg, merged into the base body.",
    indexed: false,
  });
  return {
    topZ: tExpr,
    halfWidth: `${wExpr} / 2`,
    halfDepth: null,
    boundingBoxMm: { minXMm: -w / 2, minYMm: 0, minZMm: 0, maxXMm: w / 2, maxYMm: legA, maxZMm: legB },
    volumeMm3: w * (legA * t + t * legB - t * t),
    topFaceZMm: t,
  };
}

// ---------------------------------------------------------------------------
// Hole patterns
// ---------------------------------------------------------------------------

type PatternEmission = {
  /** FeatureScript lines that build `<token>Centers`. */
  lines: string[];
  /** Centres the same arithmetic produces locally, in the same order. */
  centersMm: Point2Mm[];
  /** True when the point list is baked in as literals and cannot be edited as a parameter. */
  frozen: boolean;
};

function emitPattern(
  builder: PartBuilder,
  token: string,
  /** Path-style label used in error messages, e.g. "holes[0]". */
  label: string,
  /** The caller's own id, used for the parameter names a student sees in Onshape. */
  displayName: string,
  hole: HoleSpec,
  index: number,
  frame: BaseFrame,
): PatternEmission {
  const pattern = hole.pattern;
  const path = `holes.${index}.pattern`;
  const centersVar = `${token}Centers`;

  if (pattern.kind === "grid") {
    const countX = wholeCount(pattern.countX, `${label}.pattern.countX`);
    const countY = wholeCount(pattern.countY, `${label}.pattern.countY`);
    const pitchX = positiveMm(pattern.pitchXMm, `${label}.pattern.pitchXMm`);
    const pitchY = positiveMm(pattern.pitchYMm, `${label}.pattern.pitchYMm`);
    const cxExpr = builder.count(`${token}CountX`, `${displayName} count across X`, countX, `${path}.countX`);
    const cyExpr = builder.count(`${token}CountY`, `${displayName} count across Y`, countY, `${path}.countY`);
    const pxExpr = builder.length(`${token}PitchX`, `${displayName} X pitch`, pitchX, `${path}.pitchXMm`);
    const pyExpr = builder.length(`${token}PitchY`, `${displayName} Y pitch`, pitchY, `${path}.pitchYMm`);
    const centersMm: Point2Mm[] = [];
    for (let ix = 0; ix < countX; ix++) {
      for (let iy = 0; iy < countY; iy++) {
        centersMm.push({
          xMm: (ix - (countX - 1) / 2) * pitchX,
          yMm: (iy - (countY - 1) / 2) * pitchY,
        });
      }
    }
    return {
      frozen: false,
      centersMm,
      lines: [
        `    var ${centersVar} = [];`,
        `    for (var ix = 0; ix < ${cxExpr}; ix += 1)`,
        `    {`,
        `        for (var iy = 0; iy < ${cyExpr}; iy += 1)`,
        `        {`,
        `            ${centersVar} = append(${centersVar}, vector((ix - (${cxExpr} - 1) / 2) * ${pxExpr}, (iy - (${cyExpr} - 1) / 2) * ${pyExpr}));`,
        `        }`,
        `    }`,
      ],
    };
  }

  if (pattern.kind === "corners") {
    if (!frame.halfWidth || !frame.halfDepth) {
      throw new Error(
        `${label} uses the "corners" pattern, which needs a base with a rectangular footprint (plate or box). Use "grid" or "explicit" on a bracket.`,
      );
    }
    const insetX = positiveMm(pattern.insetXMm, `${label}.pattern.insetXMm`);
    const insetY = positiveMm(pattern.insetYMm, `${label}.pattern.insetYMm`);
    const ixExpr = builder.length(`${token}InsetX`, `${displayName} X inset`, insetX, `${path}.insetXMm`);
    const iyExpr = builder.length(`${token}InsetY`, `${displayName} Y inset`, insetY, `${path}.insetYMm`);
    const cx = (frame.boundingBoxMm.maxXMm - frame.boundingBoxMm.minXMm) / 2 - insetX;
    const cy = (frame.boundingBoxMm.maxYMm - frame.boundingBoxMm.minYMm) / 2 - insetY;
    if (cx <= 0 || cy <= 0) {
      throw new Error(`${label} insets (${insetX} mm, ${insetY} mm) push the corner holes past the middle of the part.`);
    }
    return {
      frozen: false,
      // Counter-clockwise from the -X/-Y corner; the FeatureScript literal below
      // lists the same four points in the same order, so index N is the same hole.
      centersMm: [
        { xMm: -cx, yMm: -cy },
        { xMm: cx, yMm: -cy },
        { xMm: cx, yMm: cy },
        { xMm: -cx, yMm: cy },
      ],
      lines: [
        `    var ${token}X = ${frame.halfWidth} - ${ixExpr};`,
        `    var ${token}Y = ${frame.halfDepth} - ${iyExpr};`,
        `    var ${centersVar} = [vector(-${token}X, -${token}Y), vector(${token}X, -${token}Y), vector(${token}X, ${token}Y), vector(-${token}X, ${token}Y)];`,
      ],
    };
  }

  if (pattern.kind === "linear") {
    const count = wholeCount(pattern.count, `${label}.pattern.count`);
    const startX = coordinateMm(pattern.startXMm, `${label}.pattern.startXMm`);
    const startY = coordinateMm(pattern.startYMm, `${label}.pattern.startYMm`);
    const stepX = coordinateMm(pattern.stepXMm, `${label}.pattern.stepXMm`);
    const stepY = coordinateMm(pattern.stepYMm, `${label}.pattern.stepYMm`);
    if (stepX === 0 && stepY === 0 && count > 1) {
      throw new Error(`${label} repeats ${count} holes with a zero step — they would all land on the same point.`);
    }
    const nExpr = builder.count(`${token}Count`, `${displayName} count`, count, `${path}.count`);
    const sxExpr = builder.length(`${token}StartX`, `${displayName} start X`, startX, `${path}.startXMm`, -10_000);
    const syExpr = builder.length(`${token}StartY`, `${displayName} start Y`, startY, `${path}.startYMm`, -10_000);
    const dxExpr = builder.length(`${token}StepX`, `${displayName} X step`, stepX, `${path}.stepXMm`, -10_000);
    const dyExpr = builder.length(`${token}StepY`, `${displayName} Y step`, stepY, `${path}.stepYMm`, -10_000);
    const centersMm: Point2Mm[] = [];
    for (let i = 0; i < count; i++) centersMm.push({ xMm: startX + i * stepX, yMm: startY + i * stepY });
    return {
      frozen: false,
      centersMm,
      lines: [
        `    var ${centersVar} = [];`,
        `    for (var i = 0; i < ${nExpr}; i += 1)`,
        `    {`,
        `        ${centersVar} = append(${centersVar}, vector(${sxExpr} + i * ${dxExpr}, ${syExpr} + i * ${dyExpr}));`,
        `    }`,
      ],
    };
  }

  if (pattern.kind === "circular") {
    const count = wholeCount(pattern.count, `${label}.pattern.count`);
    const centerX = coordinateMm(pattern.centerXMm, `${label}.pattern.centerXMm`);
    const centerY = coordinateMm(pattern.centerYMm, `${label}.pattern.centerYMm`);
    const boltCircle = positiveMm(pattern.boltCircleDiameterMm, `${label}.pattern.boltCircleDiameterMm`);
    const startAngle = Number(pattern.startAngleDeg ?? 0);
    if (!Number.isFinite(startAngle) || startAngle < 0 || startAngle > 360) {
      throw new Error(`${label}.pattern.startAngleDeg must be between 0 and 360. Got ${String(pattern.startAngleDeg)}.`);
    }
    const nExpr = builder.count(`${token}Count`, `${displayName} count`, count, `${path}.count`);
    const cxExpr = builder.length(`${token}CenterX`, `${displayName} centre X`, centerX, `${path}.centerXMm`, -10_000);
    const cyExpr = builder.length(`${token}CenterY`, `${displayName} centre Y`, centerY, `${path}.centerYMm`, -10_000);
    const bcExpr = builder.length(`${token}BoltCircle`, `${displayName} bolt circle diameter`, boltCircle, `${path}.boltCircleDiameterMm`);
    const aExpr = builder.angle(`${token}StartAngle`, `${displayName} start angle`, startAngle, `${path}.startAngleDeg`);
    const centersMm: Point2Mm[] = [];
    for (let i = 0; i < count; i++) {
      const theta = ((startAngle + (i * 360) / count) * Math.PI) / 180;
      centersMm.push({
        xMm: centerX + (boltCircle / 2) * Math.cos(theta),
        yMm: centerY + (boltCircle / 2) * Math.sin(theta),
      });
    }
    return {
      frozen: false,
      centersMm,
      lines: [
        `    var ${centersVar} = [];`,
        `    for (var i = 0; i < ${nExpr}; i += 1)`,
        `    {`,
        `        var ${token}A = ${aExpr} + i * (360 * degree) / ${nExpr};`,
        `        ${centersVar} = append(${centersVar}, vector(${cxExpr} + ${bcExpr} / 2 * cos(${token}A), ${cyExpr} + ${bcExpr} / 2 * sin(${token}A)));`,
        `    }`,
      ],
    };
  }

  const points = pattern.points ?? [];
  if (!points.length) throw new Error(`${label}.pattern.points is empty — give at least one point, or use a grid/corners pattern.`);
  if (points.length > 200) throw new Error(`${label}.pattern.points has ${points.length} points; keep an explicit list to 200 or fewer.`);
  const centersMm = points.map((point, i) => ({
    xMm: coordinateMm(point.xMm, `${label}.pattern.points[${i}].xMm`),
    yMm: coordinateMm(point.yMm, `${label}.pattern.points[${i}].yMm`),
  }));
  builder.warnings.push(
    `${label} uses an explicit point list, so its hole positions are constants in the FeatureScript. Moving them needs a regenerated feature, not a parameter edit.`,
  );
  const literal = centersMm.map((point) => `vector(${fsMillimetres(point.xMm)}, ${fsMillimetres(point.yMm)})`).join(", ");
  return {
    frozen: true,
    centersMm,
    lines: [`    var ${centersVar} = [${literal}];`],
  };
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

function emitHoles(builder: PartBuilder, holes: HoleSpec[], frame: BaseFrame): PredictedHole[] {
  const predicted: PredictedHole[] = [];
  const overshoot = fsMillimetres(CUT_OVERSHOOT_MM);

  holes.forEach((hole, index) => {
    const label = `holes[${index}]`;
    const token = builder.claimToken(hole.id, `${label}.id`);
    const section = builder.section(`hole "${hole.id}"`);
    const diameter = positiveMm(hole.diameterMm, `${label}.diameterMm`);
    const through = hole.through !== false;
    const depth = through ? null : positiveMm(hole.depthMm, `${label}.depthMm`);
    if (!through && depth !== null && depth >= frame.topFaceZMm) {
      builder.warnings.push(
        `${label} ("${hole.id}") is blind at ${depth} mm but the top face is only ${frame.topFaceZMm} mm above the base — it will break through.`,
      );
    }

    const pattern = emitPattern(builder, token, label, hole.id, hole, index, frame);
    const dExpr = builder.length(`${token}Diameter`, `${hole.id} diameter`, diameter, `holes.${index}.diameterMm`);

    const topZ = `${frame.topZ} + ${overshoot}`;
    const bottomZ = through
      ? fsMillimetres(-CUT_OVERSHOOT_MM)
      : `${frame.topZ} - ${builder.length(`${token}Depth`, `${hole.id} depth`, depth ?? 0, `holes.${index}.depthMm`)}`;

    section.lines.push(...pattern.lines);
    section.lines.push(
      `    var ${token}Tools = [];`,
      `    for (var i = 0; i < size(${token}Centers); i += 1)`,
      `    {`,
      `        var ${token}C = ${token}Centers[i];`,
      `        fCylinder(context, id + "${token}Hole" + i, {`,
      `                "topCenter" : vector(${token}C[0], ${token}C[1], ${topZ}),`,
      `                "bottomCenter" : vector(${token}C[0], ${token}C[1], ${bottomZ}),`,
      `                "radius" : ${dExpr} / 2`,
      `        });`,
      `        ${token}Tools = append(${token}Tools, qCreatedBy(id + "${token}Hole" + i, EntityType.BODY));`,
    );

    let counterboreDiameter: number | null = null;
    let counterboreDepth: number | null = null;
    if (hole.counterbore) {
      counterboreDiameter = positiveMm(hole.counterbore.diameterMm, `${label}.counterbore.diameterMm`);
      counterboreDepth = positiveMm(hole.counterbore.depthMm, `${label}.counterbore.depthMm`);
      if (counterboreDiameter <= diameter) {
        throw new Error(`${label}.counterbore.diameterMm (${counterboreDiameter} mm) must be larger than the hole (${diameter} mm).`);
      }
      const cbdExpr = builder.length(`${token}CboreDiameter`, `${hole.id} counterbore diameter`, counterboreDiameter, `holes.${index}.counterbore.diameterMm`);
      const cbzExpr = builder.length(`${token}CboreDepth`, `${hole.id} counterbore depth`, counterboreDepth, `holes.${index}.counterbore.depthMm`);
      section.lines.push(
        `        fCylinder(context, id + "${token}Cbore" + i, {`,
        `                "topCenter" : vector(${token}C[0], ${token}C[1], ${frame.topZ} + ${overshoot}),`,
        `                "bottomCenter" : vector(${token}C[0], ${token}C[1], ${frame.topZ} - ${cbzExpr}),`,
        `                "radius" : ${cbdExpr} / 2`,
        `        });`,
        `        ${token}Tools = append(${token}Tools, qCreatedBy(id + "${token}Cbore" + i, EntityType.BODY));`,
      );
      builder.bind({
        token: `holes.${hole.id}.counterbore`,
        subIds: [`${token}Cbore`, "<index>"],
        entityType: "BODY",
        description: `Counterbore cut tool for "${hole.id}"; index runs 0..n-1 in pattern order.`,
        indexed: true,
      });
    }

    section.lines.push(
      `    }`,
      `    if (size(${token}Tools) > 0)`,
      `    {`,
      `        opBoolean(context, id + "${token}Cut", {`,
      `                "tools" : qUnion(${token}Tools),`,
      `                "targets" : partBody,`,
      `                "operationType" : BooleanOperationType.SUBTRACTION`,
      `        });`,
      `    }`,
    );

    builder.bind({
      token: `holes.${hole.id}`,
      subIds: [`${token}Hole`, "<index>"],
      entityType: "BODY",
      description: `Cut tool for "${hole.id}"; index runs 0..n-1 in pattern order.`,
      indexed: true,
    });
    builder.bind({
      token: `holes.${hole.id}.cut`,
      subIds: [`${token}Cut`],
      entityType: "FACE",
      description: `Faces the "${hole.id}" subtraction produced on the part body.`,
      indexed: false,
    });

    pattern.centersMm.forEach((center, i) => {
      predicted.push({
        holeId: hole.id,
        index: i,
        xMm: center.xMm,
        yMm: center.yMm,
        diameterMm: diameter,
        through,
        depthMm: depth,
        counterboreDiameterMm: counterboreDiameter,
        counterboreDepthMm: counterboreDepth,
      });
    });
  });

  return predicted;
}

// ---------------------------------------------------------------------------
// Pockets, ribs, bosses
// ---------------------------------------------------------------------------

function emitPockets(builder: PartBuilder, pockets: PocketSpec[], frame: BaseFrame): number {
  const overshoot = fsMillimetres(CUT_OVERSHOOT_MM);
  let removedVolume = 0;

  pockets.forEach((pocket, index) => {
    const label = `pockets[${index}]`;
    const token = builder.claimToken(pocket.id, `${label}.id`);
    const section = builder.section(`pocket "${pocket.id}"`);
    const width = positiveMm(pocket.widthMm, `${label}.widthMm`);
    const depth = positiveMm(pocket.depthMm, `${label}.depthMm`);
    const cut = positiveMm(pocket.cutDepthMm, `${label}.cutDepthMm`);
    const cx = coordinateMm(pocket.centerXMm, `${label}.centerXMm`);
    const cy = coordinateMm(pocket.centerYMm, `${label}.centerYMm`);
    const cxExpr = builder.length(`${token}CenterX`, `${pocket.id} centre X`, cx, `pockets.${index}.centerXMm`, -10_000);
    const cyExpr = builder.length(`${token}CenterY`, `${pocket.id} centre Y`, cy, `pockets.${index}.centerYMm`, -10_000);
    const wExpr = builder.length(`${token}Width`, `${pocket.id} width`, width, `pockets.${index}.widthMm`);
    const dExpr = builder.length(`${token}Depth`, `${pocket.id} depth`, depth, `pockets.${index}.depthMm`);
    const cutExpr = builder.length(`${token}CutDepth`, `${pocket.id} cut depth`, cut, `pockets.${index}.cutDepthMm`);

    section.lines.push(
      `    fCuboid(context, id + "${token}Tool", {`,
      `            "corner1" : vector(${cxExpr} - ${wExpr} / 2, ${cyExpr} - ${dExpr} / 2, ${frame.topZ} - ${cutExpr}),`,
      `            "corner2" : vector(${cxExpr} + ${wExpr} / 2, ${cyExpr} + ${dExpr} / 2, ${frame.topZ} + ${overshoot})`,
      `    });`,
    );

    if (pocket.cornerRadiusMm !== undefined) {
      const radius = positiveMm(pocket.cornerRadiusMm, `${label}.cornerRadiusMm`);
      if (2 * radius >= Math.min(width, depth)) {
        throw new Error(`${label}.cornerRadiusMm (${radius} mm) does not fit a ${width} x ${depth} mm pocket.`);
      }
      const rExpr = builder.length(`${token}CornerRadius`, `${pocket.id} corner radius`, radius, `pockets.${index}.cornerRadiusMm`);
      builder.needsVerticalEdgeHelper = true;
      section.lines.push(
        `    var ${token}ToolEdges = vantageVerticalEdges(context, qCreatedBy(id + "${token}Tool", EntityType.BODY));`,
        `    if (size(evaluateQuery(context, ${token}ToolEdges)) > 0)`,
        `    {`,
        `        opFillet(context, id + "${token}ToolFillet", { "entities" : ${token}ToolEdges, "radius" : ${rExpr} });`,
        `    }`,
      );
    }

    section.lines.push(
      `    opBoolean(context, id + "${token}Cut", {`,
      `            "tools" : qCreatedBy(id + "${token}Tool", EntityType.BODY),`,
      `            "targets" : partBody,`,
      `            "operationType" : BooleanOperationType.SUBTRACTION`,
      `    });`,
    );

    builder.bind({
      token: `pockets.${pocket.id}`,
      subIds: [`${token}Cut`],
      entityType: "FACE",
      description: `Faces the "${pocket.id}" pocket cut produced.`,
      indexed: false,
    });
    removedVolume += width * depth * cut;
  });

  return removedVolume;
}

/**
 * Ribs and bosses stand proud of the base, so they can push the bounding box out
 * in X, Y and Z. The box is what the DFM bed-size check reads, so it is grown
 * from the real geometry rather than assumed to equal the base footprint.
 */
type Extents = { minXMm: number; minYMm: number; maxXMm: number; maxYMm: number; maxZMm: number };

function growExtents(box: PredictedGeometry["boundingBoxMm"], extents: readonly Extents[]): PredictedGeometry["boundingBoxMm"] {
  return extents.reduce<PredictedGeometry["boundingBoxMm"]>(
    (current, extent) => ({
      minXMm: Math.min(current.minXMm, extent.minXMm),
      minYMm: Math.min(current.minYMm, extent.minYMm),
      minZMm: current.minZMm,
      maxXMm: Math.max(current.maxXMm, extent.maxXMm),
      maxYMm: Math.max(current.maxYMm, extent.maxYMm),
      maxZMm: Math.max(current.maxZMm, extent.maxZMm),
    }),
    { ...box },
  );
}

function emitRibs(builder: PartBuilder, ribs: RibSpec[], frame: BaseFrame): { volumeMm3: number; extents: Extents[] } {
  let volume = 0;
  const extents: Extents[] = [];

  ribs.forEach((rib, index) => {
    const label = `ribs[${index}]`;
    const token = builder.claimToken(rib.id, `${label}.id`);
    const section = builder.section(`rib "${rib.id}"`);
    const fromX = coordinateMm(rib.fromXMm, `${label}.fromXMm`);
    const fromY = coordinateMm(rib.fromYMm, `${label}.fromYMm`);
    const toX = coordinateMm(rib.toXMm, `${label}.toXMm`);
    const toY = coordinateMm(rib.toYMm, `${label}.toYMm`);
    const thickness = positiveMm(rib.thicknessMm, `${label}.thicknessMm`);
    const height = positiveMm(rib.heightMm, `${label}.heightMm`);

    const alongX = fromY === toY && fromX !== toX;
    const alongY = fromX === toX && fromY !== toY;
    if (!alongX && !alongY) {
      throw new Error(
        `${label} ("${rib.id}") runs from (${fromX}, ${fromY}) to (${toX}, ${toY}). Ribs must be axis-aligned — keep either X or Y constant, or model a diagonal brace as an explicit part.`,
      );
    }

    const startMm = alongX ? Math.min(fromX, toX) : Math.min(fromY, toY);
    const endMm = alongX ? Math.max(fromX, toX) : Math.max(fromY, toY);
    const offsetMm = alongX ? fromY : fromX;
    const startPath = alongX ? `ribs.${index}.fromXMm` : `ribs.${index}.fromYMm`;
    const endPath = alongX ? `ribs.${index}.toXMm` : `ribs.${index}.toYMm`;
    const offsetPath = alongX ? `ribs.${index}.fromYMm` : `ribs.${index}.fromXMm`;

    const startExpr = builder.length(`${token}Start`, `${rib.id} start`, startMm, startPath, -10_000);
    const endExpr = builder.length(`${token}End`, `${rib.id} end`, endMm, endPath, -10_000);
    const offsetExpr = builder.length(`${token}Offset`, `${rib.id} offset`, offsetMm, offsetPath, -10_000);
    const tExpr = builder.length(`${token}Thickness`, `${rib.id} thickness`, thickness, `ribs.${index}.thicknessMm`);
    const hExpr = builder.length(`${token}Height`, `${rib.id} height`, height, `ribs.${index}.heightMm`);

    const corner1 = alongX
      ? `vector(${startExpr}, ${offsetExpr} - ${tExpr} / 2, ${frame.topZ})`
      : `vector(${offsetExpr} - ${tExpr} / 2, ${startExpr}, ${frame.topZ})`;
    const corner2 = alongX
      ? `vector(${endExpr}, ${offsetExpr} + ${tExpr} / 2, ${frame.topZ} + ${hExpr})`
      : `vector(${offsetExpr} + ${tExpr} / 2, ${endExpr}, ${frame.topZ} + ${hExpr})`;

    section.lines.push(
      `    fCuboid(context, id + "${token}", { "corner1" : ${corner1}, "corner2" : ${corner2} });`,
      `    opBoolean(context, id + "${token}Join", {`,
      `            "tools" : qCreatedBy(id + "${token}", EntityType.BODY),`,
      `            "targets" : partBody,`,
      `            "operationType" : BooleanOperationType.UNION`,
      `    });`,
    );

    builder.bind({
      token: `ribs.${rib.id}`,
      subIds: [token],
      entityType: "BODY",
      description: `Rib "${rib.id}" before it is merged into the part body.`,
      indexed: false,
    });
    volume += (endMm - startMm) * thickness * height;
    extents.push(
      alongX
        ? {
            minXMm: startMm,
            maxXMm: endMm,
            minYMm: offsetMm - thickness / 2,
            maxYMm: offsetMm + thickness / 2,
            maxZMm: frame.topFaceZMm + height,
          }
        : {
            minXMm: offsetMm - thickness / 2,
            maxXMm: offsetMm + thickness / 2,
            minYMm: startMm,
            maxYMm: endMm,
            maxZMm: frame.topFaceZMm + height,
          },
    );
  });

  return { volumeMm3: volume, extents };
}

function emitBosses(builder: PartBuilder, bosses: BossSpec[], frame: BaseFrame): { volumeMm3: number; extents: Extents[] } {
  const overshoot = fsMillimetres(CUT_OVERSHOOT_MM);
  let volume = 0;
  const extents: Extents[] = [];

  bosses.forEach((boss, index) => {
    const label = `bosses[${index}]`;
    const token = builder.claimToken(boss.id, `${label}.id`);
    const section = builder.section(`boss "${boss.id}"`);
    const cx = coordinateMm(boss.centerXMm, `${label}.centerXMm`);
    const cy = coordinateMm(boss.centerYMm, `${label}.centerYMm`);
    const outer = positiveMm(boss.outerDiameterMm, `${label}.outerDiameterMm`);
    const height = positiveMm(boss.heightMm, `${label}.heightMm`);
    const insert = positiveMm(boss.insertDiameterMm, `${label}.insertDiameterMm`);
    const insertDepth = positiveMm(boss.insertDepthMm, `${label}.insertDepthMm`);
    if (insert >= outer) {
      throw new Error(`${label}.insertDiameterMm (${insert} mm) must be smaller than the boss outer diameter (${outer} mm).`);
    }
    if (insertDepth > height + frame.topFaceZMm) {
      throw new Error(`${label}.insertDepthMm (${insertDepth} mm) is deeper than the boss plus the part beneath it.`);
    }

    const cxExpr = builder.length(`${token}CenterX`, `${boss.id} centre X`, cx, `bosses.${index}.centerXMm`, -10_000);
    const cyExpr = builder.length(`${token}CenterY`, `${boss.id} centre Y`, cy, `bosses.${index}.centerYMm`, -10_000);
    const odExpr = builder.length(`${token}OuterDiameter`, `${boss.id} outer diameter`, outer, `bosses.${index}.outerDiameterMm`);
    const hExpr = builder.length(`${token}Height`, `${boss.id} height`, height, `bosses.${index}.heightMm`);
    const idExpr = builder.length(`${token}InsertDiameter`, `${boss.id} insert bore diameter`, insert, `bosses.${index}.insertDiameterMm`);
    const depthExpr = builder.length(`${token}InsertDepth`, `${boss.id} insert bore depth`, insertDepth, `bosses.${index}.insertDepthMm`);

    section.lines.push(
      `    fCylinder(context, id + "${token}", {`,
      `            "topCenter" : vector(${cxExpr}, ${cyExpr}, ${frame.topZ} + ${hExpr}),`,
      `            "bottomCenter" : vector(${cxExpr}, ${cyExpr}, ${frame.topZ}),`,
      `            "radius" : ${odExpr} / 2`,
      `    });`,
      `    opBoolean(context, id + "${token}Join", {`,
      `            "tools" : qCreatedBy(id + "${token}", EntityType.BODY),`,
      `            "targets" : partBody,`,
      `            "operationType" : BooleanOperationType.UNION`,
      `    });`,
      `    fCylinder(context, id + "${token}Bore", {`,
      `            "topCenter" : vector(${cxExpr}, ${cyExpr}, ${frame.topZ} + ${hExpr} + ${overshoot}),`,
      `            "bottomCenter" : vector(${cxExpr}, ${cyExpr}, ${frame.topZ} + ${hExpr} - ${depthExpr}),`,
      `            "radius" : ${idExpr} / 2`,
      `    });`,
      `    opBoolean(context, id + "${token}BoreCut", {`,
      `            "tools" : qCreatedBy(id + "${token}Bore", EntityType.BODY),`,
      `            "targets" : partBody,`,
      `            "operationType" : BooleanOperationType.SUBTRACTION`,
      `    });`,
    );

    builder.bind({
      token: `bosses.${boss.id}`,
      subIds: [token],
      entityType: "BODY",
      description: `Heat-set boss "${boss.id}" before it is merged into the part body.`,
      indexed: false,
    });
    builder.bind({
      token: `bosses.${boss.id}.bore`,
      subIds: [`${token}BoreCut`],
      entityType: "FACE",
      description: `Insert bore faces for "${boss.id}" — the surface the heat-set insert grips.`,
      indexed: false,
    });

    volume += (Math.PI / 4) * outer * outer * height - (Math.PI / 4) * insert * insert * insertDepth;
    extents.push({
      minXMm: cx - outer / 2,
      maxXMm: cx + outer / 2,
      minYMm: cy - outer / 2,
      maxYMm: cy + outer / 2,
      maxZMm: frame.topFaceZMm + height,
    });
  });

  return { volumeMm3: volume, extents };
}

function emitEdges(builder: PartBuilder, edges: EdgeTreatmentSpec[]): void {
  edges.forEach((edge, index) => {
    const label = `edges[${index}]`;
    const token = builder.claimToken(edge.id, `${label}.id`);
    const section = builder.section(`${edge.kind} "${edge.id}"`);
    const size = positiveMm(edge.sizeMm, `${label}.sizeMm`);
    if (edge.kind !== "fillet" && edge.kind !== "chamfer") {
      throw new Error(`${label}.kind must be "fillet" or "chamfer". Got "${String(edge.kind)}".`);
    }
    if (edge.selection !== "corners" && edge.selection !== "all") {
      throw new Error(`${label}.selection must be "corners" or "all". Got "${String(edge.selection)}".`);
    }
    const sizeExpr = builder.length(`${token}Size`, `${edge.id} ${edge.kind === "fillet" ? "radius" : "width"}`, size, `edges.${index}.sizeMm`);

    let query: string;
    if (edge.selection === "corners") {
      builder.needsVerticalEdgeHelper = true;
      query = `vantageVerticalEdges(context, partBody)`;
    } else {
      query = `qOwnedByBody(partBody, EntityType.EDGE)`;
    }

    // An empty edge selection makes opFillet/opChamfer throw. Skipping is the
    // honest outcome: the part still builds and the caller sees the warning.
    // opChamfer's documented map keys are entities / chamferType / width, and
    // ChamferType.EQUAL_OFFSETS is the equal-leg case — https://cad.onshape.com/FsDoc/library.html
    section.lines.push(
      `    var ${token}Edges = ${query};`,
      `    if (size(evaluateQuery(context, ${token}Edges)) > 0)`,
      `    {`,
      edge.kind === "fillet"
        ? `        opFillet(context, id + "${token}", { "entities" : ${token}Edges, "radius" : ${sizeExpr} });`
        : `        opChamfer(context, id + "${token}", { "entities" : ${token}Edges, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : ${sizeExpr} });`,
      `    }`,
    );

    builder.bind({
      token: `edges.${edge.id}`,
      subIds: [token],
      entityType: "FACE",
      description: `Faces produced by the "${edge.id}" ${edge.kind}.`,
      indexed: false,
    });
  });
}

// ---------------------------------------------------------------------------
// Assembly of the source
// ---------------------------------------------------------------------------

/**
 * Vertical (Z-parallel) straight edges of a body. Emitted once and shared by the
 * corner fillet and by pocket corner radii. Same technique as
 * onshape-resolve.parallelEdgesScript, run inside the feature instead of over REST.
 */
function verticalEdgeHelper(): string {
  return [
    `function vantageVerticalEdges(context is Context, bodies is Query) returns Query`,
    `{`,
    `    var kept = [];`,
    `    for (var edge in evaluateQuery(context, qGeometry(qOwnedByBody(bodies, EntityType.EDGE), GeometryType.LINE)))`,
    `    {`,
    `        var line = evEdgeTangentLine(context, { "edge" : edge, "parameter" : 0.5 });`,
    `        if (abs(dot(line.direction, vector(0, 0, 1))) > 0.99)`,
    `        {`,
    `            kept = append(kept, edge);`,
    `        }`,
    `    }`,
    `    return qUnion(kept);`,
    `}`,
    ``,
    ``,
  ].join("\n");
}

function preconditionLines(parameters: FeatureScriptParameter[]): string[] {
  return parameters.flatMap((parameter) => {
    const escapedLabel = parameter.label.replace(/["\\]/g, "");
    const check =
      parameter.kind === "length"
        ? `isLength(definition.${parameter.parameterId}, LENGTH_BOUNDS);`
        : parameter.kind === "angle"
          ? `isAngle(definition.${parameter.parameterId}, ANGLE_360_BOUNDS);`
          : `isInteger(definition.${parameter.parameterId}, POSITIVE_COUNT_BOUNDS);`;
    return [`        annotation { "Name" : "${escapedLabel}" }`, `        ${check}`];
  });
}

function featureTypeIdentifier(name: string): string {
  const token = featureScriptToken(name, "definition.name");
  return `vantage${token[0]!.toUpperCase()}${token.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generatePartFeatureScript(definition: PartDefinition, options: GenerateOptions = {}): GeneratedPartFeature {
  const name = String(definition?.name ?? "").trim();
  if (!name) throw new Error("definition.name is required — it becomes the Onshape feature name.");
  if (!definition.base) throw new Error("definition.base is required (plate, box, or bracket).");

  const version = Math.round(Number(options.featureScriptVersion ?? DEFAULT_FEATURESCRIPT_VERSION));
  if (!Number.isFinite(version) || version < 100 || version > 100_000) {
    throw new Error(`featureScriptVersion must be an Onshape release number such as ${DEFAULT_FEATURESCRIPT_VERSION}. Got ${String(options.featureScriptVersion)}.`);
  }
  const limit = options.sourceLimit ?? FEATURESCRIPT_SOURCE_LIMIT;

  const builder = new PartBuilder();
  const frame = emitBase(builder, definition.base);

  const bosses = emitBosses(builder, definition.bosses ?? [], frame);
  const ribs = emitRibs(builder, definition.ribs ?? [], frame);
  const pocketVolume = emitPockets(builder, definition.pockets ?? [], frame);
  const holes = emitHoles(builder, definition.holes ?? [], frame);
  emitEdges(builder, definition.edges ?? []);

  const featureTypeId = featureTypeIdentifier(name);
  const header = [
    `FeatureScript ${version};`,
    `import(path : "onshape/std/geometry.fs", version : "${version}.0");`,
    ``,
    ``,
  ].join("\n");
  const helper = builder.needsVerticalEdgeHelper ? verticalEdgeHelper() : "";
  const opening = [
    `annotation { "Feature Type Name" : "${name.replace(/["\\]/g, "")}" }`,
    `export const ${featureTypeId} = defineFeature(function(context is Context, id is Id, definition is map)`,
    `    precondition`,
    `    {`,
    ...preconditionLines(builder.parameters),
    `    }`,
    `    {`,
  ].join("\n");
  // Section lines are written at the natural nesting of their own block; the
  // feature body sits one level inside `defineFeature`, so indent it here rather
  // than threading a depth argument through every emitter.
  const indent = (lines: readonly string[]): string => lines.map((line) => (line ? `    ${line}` : line)).join("\n");
  const body = builder.sections.map((section) => indent(section.lines)).join("\n");
  const closing = `\n    });\n`;
  const source = `${header}${helper}${opening}\n${body}${closing}`;

  const sections: SourceBudgetSection[] = [
    { label: "header + feature declaration", characters: header.length + helper.length + opening.length + closing.length },
    ...builder.sections.map((section) => ({ label: section.label, characters: indent(section.lines).length + 1 })),
  ];

  if (source.length > limit) {
    const worst = [...sections].sort((a, b) => b.characters - a.characters).slice(0, 3);
    const detail = worst.map((section) => `${section.label} (${section.characters.toLocaleString("en-US")} chars)`).join(", ");
    throw new Error(
      `"${name}" generates ${source.length.toLocaleString("en-US")} characters of FeatureScript, over the ${limit.toLocaleString("en-US")}-character limit. Largest contributors: ${detail}. Split the part into two features, or replace an explicit point list with a grid/circular pattern.`,
    );
  }

  const holeVolume = holes.reduce((total, hole) => {
    const depth = hole.through ? frame.topFaceZMm : (hole.depthMm ?? 0);
    const shaft = (Math.PI / 4) * hole.diameterMm * hole.diameterMm * depth;
    const counterbore =
      hole.counterboreDiameterMm && hole.counterboreDepthMm
        ? (Math.PI / 4) * (hole.counterboreDiameterMm ** 2 - hole.diameterMm ** 2) * hole.counterboreDepthMm
        : 0;
    return total + shaft + counterbore;
  }, 0);

  const boundingBoxMm = growExtents(frame.boundingBoxMm, [...ribs.extents, ...bosses.extents]);
  const geometry: PredictedGeometry = {
    boundingBoxMm,
    sizeMm: {
      xMm: boundingBoxMm.maxXMm - boundingBoxMm.minXMm,
      yMm: boundingBoxMm.maxYMm - boundingBoxMm.minYMm,
      zMm: boundingBoxMm.maxZMm - boundingBoxMm.minZMm,
    },
    holes,
    bodyCount: 1,
    approxSolidVolumeMm3: Number(
      Math.max(0, frame.volumeMm3 + ribs.volumeMm3 + bosses.volumeMm3 - pocketVolume - holeVolume).toFixed(3),
    ),
    volumeCaveats: [
      "Fillets and chamfers are not subtracted.",
      "Overlapping ribs, pockets or holes are counted once each, so an intersecting layout over-removes material.",
      "Through-hole depth is taken as the base top-face height, which is exact for a plate and approximate elsewhere.",
      "Use the Onshape mass-properties readback for a real volume before quoting print time or cost.",
    ],
  };

  return {
    featureTypeName: name,
    featureTypeId,
    featureScriptVersion: version,
    source,
    parameters: builder.parameters,
    ids: builder.ids,
    geometry,
    warnings: builder.warnings,
    sourceBudget: { limit, used: source.length, sections },
    definition: clonePartDefinition(definition),
  };
}


// ---------------------------------------------------------------------------
// Parameter edits
// ---------------------------------------------------------------------------

export type ParameterEdit = { parameterId: string; value: number };

export type ParameterEditPlan =
  | {
      kind: "parameter-update";
      /** Full parameter list with the edits applied — send this on the existing feature. */
      parameters: FeatureScriptParameter[];
      changed: string[];
      /** The local definition kept in step, so the DFM pass can re-check without a round trip. */
      definition: PartDefinition;
      /** One Onshape call: update the existing feature. No regenerate, no re-insert. */
      onshapeCalls: 1;
    }
  | { kind: "rebuild-required"; reason: string };

/**
 * Decide whether an edit is a cheap parameter change on the EXISTING feature or
 * needs a regenerated feature. The generated source only ever references
 * `definition.<parameterId>`, so any edit that stays inside the parameter list
 * leaves the source byte-identical — that is what makes "make it 8 mm instead of
 * 6" one call instead of a rebuild.
 */
export function planParameterEdit(generated: GeneratedPartFeature, edits: readonly ParameterEdit[]): ParameterEditPlan {
  if (!edits.length) return { kind: "rebuild-required", reason: "No edits were given." };

  const byId = new Map(generated.parameters.map((parameter) => [parameter.parameterId, parameter]));
  const definition = clonePartDefinition(generated.definition);
  const parameters = generated.parameters.map((parameter) => ({ ...parameter }));
  const changed: string[] = [];

  for (const edit of edits) {
    const existing = byId.get(edit.parameterId);
    if (!existing) {
      return {
        kind: "rebuild-required",
        reason: `"${edit.parameterId}" is not a parameter of this feature. Structural changes — adding a hole group, changing a pattern kind, moving an explicit point list — need a regenerated feature.`,
      };
    }
    const value = Number(edit.value);
    if (!Number.isFinite(value)) {
      return { kind: "rebuild-required", reason: `"${edit.parameterId}" was given a non-numeric value.` };
    }
    if (existing.kind === "count" && !Number.isInteger(value)) {
      return { kind: "rebuild-required", reason: `"${edit.parameterId}" is a count and must be a whole number. Got ${value}.` };
    }
    if (value < existing.minimum || value > existing.maximum) {
      return {
        kind: "rebuild-required",
        reason: `"${edit.parameterId}" accepts ${existing.minimum} to ${existing.maximum}; ${value} is outside that range.`,
      };
    }

    const target = parameters.find((parameter) => parameter.parameterId === edit.parameterId)!;
    target.value = value;
    target.expression = expressionFor(target.kind, value);
    setDefinitionPath(definition, target.path, value);
    changed.push(edit.parameterId);
  }

  return { kind: "parameter-update", parameters, changed, definition, onshapeCalls: 1 };
}
