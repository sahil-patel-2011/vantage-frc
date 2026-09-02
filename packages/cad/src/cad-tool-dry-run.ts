/**
 * Plan-mode dry runs: one honest sentence per proposed tool call, computed from
 * the arguments the model proposed and NOTHING else — no Onshape call, no
 * guessed geometry. This is what a mentor reads before pressing Approve, so it
 * restates every number in millimetres and names the defaults a tool would fall
 * back to ("last sketch", "last solid") instead of hiding them.
 *
 * Pure. Shared by the hosted agent's plan endpoint and the terminal.
 */

import { cadToolSpec, hostedCadToolNames } from "./cad-tool-catalog";

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mm(value: unknown, fallback = "?"): string {
  const n = num(value);
  return n === undefined ? fallback : `${n} mm`;
}

function plane(value: unknown, fallback = "Top"): string {
  return str(value) || fallback;
}

function ref(value: unknown, fallback: string): string {
  const id = str(value);
  return id ? `feature ${id}` : fallback;
}

function count(value: unknown): string {
  const n = num(value);
  return n === undefined ? "?" : String(Math.round(n));
}

/**
 * Describe what a tool call would do. Returns a sentence for every hosted tool;
 * an unknown tool gets an explicit "not a hosted tool" line so a plan cannot
 * quietly carry a step the executor will refuse.
 */
export function describeCadToolDryRun(tool: string, args: Record<string, unknown> = {}): string {
  switch (tool) {
    case "onshape_sketch_rectangle": {
      const origin =
        num(args.originXMm) !== undefined || num(args.originYMm) !== undefined
          ? ` with its corner at (${num(args.originXMm) ?? 0}, ${num(args.originYMm) ?? 0}) mm`
          : " from the origin";
      return `Sketch a ${mm(args.widthMm)} × ${mm(args.heightMm)} rectangle on ${plane(args.plane)}${origin}.`;
    }
    case "onshape_sketch_circle": {
      const circles = Array.isArray(args.circles) ? (args.circles as Array<Record<string, unknown>>) : null;
      if (circles?.length) {
        const list = circles
          .slice(0, 6)
          .map((circle) => `⌀${mm(circle?.diameterMm ?? circle?.diameter)} at (${num(circle?.centerXMm ?? circle?.x) ?? 0}, ${num(circle?.centerYMm ?? circle?.y) ?? 0})`)
          .join(", ");
        return `Sketch ${circles.length} circle${circles.length === 1 ? "" : "s"} on ${plane(args.plane)}: ${list}${circles.length > 6 ? ", …" : ""}.`;
      }
      return `Sketch a ⌀${mm(args.diameterMm)} circle on ${plane(args.plane)} centred at (${num(args.centerXMm) ?? 0}, ${num(args.centerYMm) ?? 0}) mm.`;
    }
    case "onshape_sketch_polyline": {
      const points = Array.isArray(args.points) ? args.points.length : 0;
      const closed = args.closed === false ? "open path" : "closed outline";
      return `Sketch a ${closed} through ${points} point${points === 1 ? "" : "s"} on ${plane(args.plane)}.`;
    }
    case "onshape_sketch_points": {
      if (Array.isArray(args.points)) {
        return `Place ${args.points.length} hole point${args.points.length === 1 ? "" : "s"} on ${plane(args.plane)} for the next hole step.`;
      }
      const countX = num(args.gridCountX) ?? 0;
      const countY = num(args.gridCountY) ?? 1;
      const pitchX = num(args.gridPitchXMm);
      const pitchY = num(args.gridPitchYMm) ?? pitchX;
      return `Place a ${countX} × ${countY} grid of hole points on ${plane(args.plane)} at ${mm(pitchX)}${countY > 1 ? ` × ${mm(pitchY)}` : ""} pitch, starting at (${num(args.originXMm) ?? 0}, ${num(args.originYMm) ?? 0}) mm.`;
    }
    case "onshape_sketch_slot":
      return `Sketch a ${mm(args.lengthMm)} × ${mm(args.widthMm)} slot on ${plane(args.plane)} centred at (${num(args.centerXMm) ?? 0}, ${num(args.centerYMm) ?? 0}) mm${num(args.angleDeg) ? ` at ${num(args.angleDeg)}°` : ""}.`;
    case "onshape_sketch_polygon": {
      const size =
        num(args.acrossFlatsMm) !== undefined
          ? `${mm(args.acrossFlatsMm)} across flats`
          : `${mm(args.circumscribedDiameterMm)} corner to corner`;
      return `Sketch a ${count(args.sides)}-sided polygon, ${size}, on ${plane(args.plane)} centred at (${num(args.centerXMm) ?? 0}, ${num(args.centerYMm) ?? 0}) mm.`;
    }
    case "onshape_extrude": {
      const op = (str(args.operationType) || "NEW").toUpperCase();
      const verb = op === "REMOVE" ? "Cut" : op === "ADD" ? "Add" : op === "INTERSECT" ? "Intersect" : "Extrude a new body";
      return `${verb} ${mm(args.depthMm)} ${op === "NEW" ? "" : `(${op}) `}from ${ref(args.sketchFeatureId, "the last sketch")}${args.oppositeDirection ? ", opposite direction" : ""}.`;
    }
    case "onshape_fillet":
      return `Fillet the ${str(args.selection) === "all" ? "edges" : "corner edges"} of ${ref(args.featureId, "the last solid")} at ${mm(args.radiusMm)} radius.`;
    case "onshape_chamfer":
      return `Chamfer the ${str(args.selection) === "all" ? "edges" : "corner edges"} of ${ref(args.featureId, "the last solid")} at ${mm(args.widthMm)}.`;
    case "onshape_hole": {
      const end = (str(args.endStyle) || "THROUGH").toUpperCase();
      return `Drill ⌀${mm(args.diameterMm)} ${end === "BLIND" ? `${mm(args.depthMm)} deep` : "through"} holes at the points of ${ref(args.pointSketchFeatureId, "the last point sketch")}${str(args.targetFeatureId) ? ` into feature ${str(args.targetFeatureId)}` : ""}.`;
    }
    case "onshape_shell": {
      const faces = str(args.faces) || "top";
      return `Shell ${ref(args.featureId, "the last solid")} to ${mm(args.thicknessMm)} walls, removing the ${faces === "ends" ? "top and bottom faces" : faces === "all" ? "faces it created" : `${faces} face`}.`;
    }
    case "onshape_set_variable": {
      const type = (str(args.variableType) || "LENGTH").toUpperCase();
      const unit = type === "LENGTH" ? " mm" : type === "ANGLE" ? "°" : "";
      return `Set variable #${str(args.variableName) || "?"} = ${num(args.value) ?? "?"}${unit} in the variable table.`;
    }
    case "onshape_linear_pattern": {
      const targets = Array.isArray(args.featureIds) && args.featureIds.length ? `features ${args.featureIds.join(", ")}` : "the last feature";
      return `Repeat ${targets} ${count(args.instanceCount)}× along ${str(args.direction).toUpperCase() || "X"} at ${mm(args.spacingMm)} pitch.`;
    }
    case "onshape_circular_pattern": {
      const targets = Array.isArray(args.featureIds) && args.featureIds.length ? `features ${args.featureIds.join(", ")}` : "the last feature";
      return `Repeat ${targets} ${count(args.instanceCount)}× around the cylindrical face of ${ref(args.axisFeatureId, "?")} over ${num(args.angleDeg) ?? 360}°.`;
    }
    case "onshape_mirror": {
      const targets = Array.isArray(args.featureIds) && args.featureIds.length ? `features ${args.featureIds.join(", ")}` : "the last feature";
      return `Mirror ${targets} across the ${plane(args.plane, "Right")} plane.`;
    }
    case "onshape_delete_feature":
      return `Delete ${ref(args.featureId, "the most recent feature this session added")} (only features Vantage added).`;
    case "onshape_export_stl":
      return `Export the Part Studio as binary STL (mm) and save it to the CAD vault${str(args.title) ? ` as "${str(args.title)}"` : ""}.`;
    case "onshape_export_step":
      return `Export the Part Studio as STEP via Onshape's translation service and save it to the CAD vault${str(args.title) ? ` as "${str(args.title)}"` : ""}.`;
    case "onshape_describe":
      return "Read the feature tree (no change).";
    case "onshape_bind":
      return `Bind Part Studio ${str(args.elementId) || "?"} in document ${str(args.documentId) || "?"}.`;
    case "onshape_list_documents":
    case "onshape_list_elements":
    case "cad_status":
    case "cad_tools":
    case "cad_setup":
      return `${cadToolSpec(tool)?.label ?? tool} (read-only).`;
    default:
      return hostedCadToolNames().includes(tool)
        ? `${cadToolSpec(tool)?.label ?? tool}.`
        : `"${tool}" is not a tool the hosted agent can run — this step will be refused.`;
  }
}

/** Placeholder a plan step may use to reference an earlier step's feature id. */
export const PLAN_STEP_REF_PATTERN = /^\{\{\s*step\s*:\s*(\d+)\s*\.\s*featureId\s*\}\}$/i;

/**
 * Replace `{{step:N.featureId}}` string values with the feature id that step N
 * produced. Unresolved references throw, so a step never runs against a stale
 * or invented id. Returns a new args object; the original is untouched.
 */
export function resolvePlanStepReferences(
  args: Record<string, unknown>,
  featureIdByStep: ReadonlyMap<number, string>,
): Record<string, unknown> {
  const resolveValue = (value: unknown, path: string): unknown => {
    if (typeof value === "string") {
      const match = PLAN_STEP_REF_PATTERN.exec(value.trim());
      if (!match) return value;
      const index = Number(match[1]);
      const featureId = featureIdByStep.get(index);
      if (!featureId) {
        throw new Error(`${path} references step ${index}, which has not produced a feature id yet (was it skipped or did it fail?).`);
      }
      return featureId;
    }
    if (Array.isArray(value)) return value.map((item, i) => resolveValue(item, `${path}[${i}]`));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = resolveValue(inner, `${path}.${key}`);
      return out;
    }
    return value;
  };
  return resolveValue(args, "args") as Record<string, unknown>;
}
