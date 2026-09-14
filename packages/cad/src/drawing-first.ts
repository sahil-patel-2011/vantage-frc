/**
 * Drawing-first CAD: a detailed Onshape Drawing with controlling millimetres
 * must exist before sketch / extrude. The solid is then cast from those same
 * millimetres. Never invents a dimension.
 */
import type { CadAction } from "./agent-policy";
import { parseEnvelopeMm, type EngineeringBriefLite } from "./agent-policy";
import { drawingSheetParameters, planDrawingPack } from "./drawing-pack";

const CAST_FROM_DRAWING_OPS = new Set(["create_sketch", "create_extrude"]);

const GEOMETRY_MUTATION_OPS = new Set([
  "create_sketch",
  "create_extrude",
  "create_fillet",
  "create_chamfer",
  "create_shell",
  "create_pattern",
  "create_hole",
  "create_mirror",
  "create_revolve",
  "create_boolean",
]);

export type DrawingDimensions = {
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
};

function finitePositiveMm(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return number;
}

/** Copy only millimetres that already exist. Missing values stay missing. */
export function drawingDimensionsFromParameters(parameters: Record<string, unknown> | undefined): DrawingDimensions {
  const source = parameters ?? {};
  const dims: DrawingDimensions = {};
  const widthMm = finitePositiveMm(source.widthMm);
  const heightMm = finitePositiveMm(source.heightMm);
  const depthMm = finitePositiveMm(source.depthMm);
  if (widthMm !== undefined) dims.widthMm = widthMm;
  if (heightMm !== undefined) dims.heightMm = heightMm;
  if (depthMm !== undefined) dims.depthMm = depthMm;
  return dims;
}

/**
 * Controlling millimetres from a confirmed envelope. Unparseable or missing
 * envelopes return an empty table — never a guessed plate size.
 */
export function drawingDimensionsFromBrief(brief: EngineeringBriefLite): DrawingDimensions {
  const envelope = brief.assumptions.find((item) => /envelope/i.test(item.name));
  const envelopeMm = parseEnvelopeMm(envelope?.value);
  if (envelopeMm === undefined) return {};
  return { widthMm: envelopeMm, heightMm: envelopeMm, depthMm: envelopeMm };
}

function firstGeometryDimensions(plan: readonly CadAction[]): DrawingDimensions {
  const dims: DrawingDimensions = {};
  for (const step of plan) {
    if (!CAST_FROM_DRAWING_OPS.has(step.operation)) continue;
    const next = drawingDimensionsFromParameters(step.parameters);
    if (dims.widthMm === undefined && next.widthMm !== undefined) dims.widthMm = next.widthMm;
    if (dims.heightMm === undefined && next.heightMm !== undefined) dims.heightMm = next.heightMm;
    if (dims.depthMm === undefined && next.depthMm !== undefined) dims.depthMm = next.depthMm;
  }
  return dims;
}

function drawingParameters(
  dims: DrawingDimensions,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    name: typeof extras.name === "string" && extras.name.trim() ? extras.name : "Detail drawing",
    ...extras,
  };
  if (dims.widthMm !== undefined) parameters.widthMm = dims.widthMm;
  if (dims.heightMm !== undefined) parameters.heightMm = dims.heightMm;
  if (dims.depthMm !== undefined) parameters.depthMm = dims.depthMm;
  return parameters;
}

export function createDrawingAction(
  dims: DrawingDimensions,
  extras: Record<string, unknown> = {},
): CadAction {
  return {
    operation: "create_drawing",
    parameters: drawingParameters(dims, extras),
    requiresApproval: true,
    reason: "Make a detailed drawing first so the solid is cast from those millimetres",
  };
}

/** One labeled create_drawing step per sheet. Never invents millimetres. */
export function createDrawingPackActions(
  dims: DrawingDimensions,
  extras: { partName?: string; briefSummary?: string; units?: string } = {},
): CadAction[] {
  const sheets = planDrawingPack({
    partName: extras.partName,
    dims,
    briefSummary: extras.briefSummary,
  });
  return sheets.map((sheet) =>
    createDrawingAction(dims, {
      ...drawingSheetParameters(sheet),
      ...(extras.units ? { units: extras.units } : {}),
    }),
  );
}

/**
 * Prepend create_drawing when a geometry mutation exists without a prior
 * drawing. Dimensions come from the brief or from later sketch/extrude steps.
 * Never invents millimetres.
 */
export function ensureDrawingFirstPlan(plan: CadAction[], briefDims: DrawingDimensions = {}): CadAction[] {
  const drawingIndex = plan.findIndex((step) => step.operation === "create_drawing");
  const geometryIndex = plan.findIndex((step) => GEOMETRY_MUTATION_OPS.has(step.operation));
  if (geometryIndex < 0) return plan;
  if (drawingIndex >= 0 && drawingIndex < geometryIndex) return plan;

  const dims = {
    ...briefDims,
    ...firstGeometryDimensions(plan),
  };
  const drawings = createDrawingPackActions(dims);
  if (drawingIndex >= 0) {
    const without = plan.filter((step) => step.operation !== "create_drawing");
    return [...drawings, ...without];
  }
  return [...drawings, ...plan];
}

/**
 * Sketch / extrude copy drawing millimetres when they are missing.
 * Existing finite millimetres stay. Never invents a new size.
 */
export function applyDrawingDimensionsToCast(plan: CadAction[]): CadAction[] {
  const drawing = plan.find((step) => step.operation === "create_drawing");
  if (!drawing) return plan;
  const dims = drawingDimensionsFromParameters(drawing.parameters);
  if (dims.widthMm === undefined && dims.heightMm === undefined && dims.depthMm === undefined) {
    return plan;
  }
  return plan.map((step) => {
    if (step.operation === "create_sketch") {
      const next = { ...step.parameters };
      if (next.widthMm === undefined && dims.widthMm !== undefined) next.widthMm = dims.widthMm;
      if (next.heightMm === undefined && dims.heightMm !== undefined) next.heightMm = dims.heightMm;
      return { ...step, parameters: next };
    }
    if (step.operation === "create_extrude") {
      const next = { ...step.parameters };
      if (next.depthMm === undefined && dims.depthMm !== undefined) next.depthMm = dims.depthMm;
      return { ...step, parameters: next };
    }
    return step;
  });
}
