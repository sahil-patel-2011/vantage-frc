/**
 * Job-transport dispatch for allowlisted Onshape mutations that already have
 * native BTM builders in onshape-features.ts (the same payloads claude-cad posts).
 *
 * Fillet / chamfer / shell / hole / pattern / mirror / delete become ordinary
 * Part Studio features. This module never evaluates or generates FeatureScript —
 * callers must pass already-resolved deterministic ids. Missing geometry is an
 * honest error, not a guessed id and not a silent FS fallback.
 */

import {
  booleanFeature,
  chamferFeature,
  circularPatternFeature,
  filletFeature,
  holeFeature,
  linearPatternFeature,
  mirrorFeature,
  onshapeFeaturePath,
  parseAddedFeatureId,
  patternAxisPlaneId,
  revolveFeature,
  shellFeature,
  type BooleanOperation,
  type ExtrudeOperation,
  type HoleEndStyle,
} from "./onshape-features";
import { firstPlannedId } from "./first-planned-id";
import { setOnshapeNativeVariable } from "./onshape-native-variables";

export type OnshapeNativeHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeNativeDocument = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export const ONSHAPE_NATIVE_OPERATIONS = [
  "create_fillet",
  "create_chamfer",
  "create_shell",
  "create_hole",
  "create_pattern",
  "create_mirror",
  "create_revolve",
  "create_boolean",
  "delete_feature",
  "set_variable",
] as const;

export type OnshapeNativeOperation = (typeof ONSHAPE_NATIVE_OPERATIONS)[number];

/** Allowlisted ops with no native builder yet — refuse, do not invent FeatureScript. */
export const ONSHAPE_UNIMPLEMENTED_NATIVE_OPERATIONS = [
  "rollback_checkpoint",
] as const;

export type OnshapeUnimplementedNativeOperation = (typeof ONSHAPE_UNIMPLEMENTED_NATIVE_OPERATIONS)[number];

export type OnshapeNativeDispatchResult = {
  featureId: string;
  featureScriptUsed: false;
};

export function isOnshapeNativeOperation(operation: string): operation is OnshapeNativeOperation {
  return (ONSHAPE_NATIVE_OPERATIONS as readonly string[]).includes(operation);
}

export function isOnshapeNativeUnimplemented(operation: string): operation is OnshapeUnimplementedNativeOperation {
  return (ONSHAPE_UNIMPLEMENTED_NATIVE_OPERATIONS as readonly string[]).includes(operation);
}

export function onshapeNativeUnimplementedError(operation: string): Error {
  if (operation === "rollback_checkpoint") {
    return new Error(
      "Rollback is not a native Onshape action. Humans delete the last feature from the Vantage feature tree instead.",
    );
  }
  return new Error(
    `Onshape operation '${operation}' is not implemented as a native Part Studio feature.`,
  );
}

export async function dispatchOnshapeNativeFeature(input: {
  http: OnshapeNativeHttp;
  document: OnshapeNativeDocument;
  operation: OnshapeNativeOperation;
  parameters: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<OnshapeNativeDispatchResult> {
  const { http, document, operation, parameters, idempotencyKey } = input;
  if (operation === "set_variable") {
    const result = await setOnshapeNativeVariable(http, { document, parameters, idempotencyKey });
    return { featureId: result.featureId, featureScriptUsed: false };
  }
  if (operation === "delete_feature") {
    return deleteNativeFeature(http, document, parameters, idempotencyKey);
  }
  const payload = buildNativeFeature(operation, parameters);
  const featureId = await postNativeFeature(http, document, payload, idempotencyKey);
  return { featureId, featureScriptUsed: false };
}

function buildNativeFeature(
  operation: Exclude<OnshapeNativeOperation, "delete_feature" | "set_variable">,
  parameters: Record<string, unknown>,
) {
  switch (operation) {
    case "create_fillet":
      return filletFeature({
        edgeIds: requireEntityIds(parameters, ["edgeIds", "entities", "edges"], "edgeIds"),
        radiusMm: requireNumber(parameters, ["radiusMm", "radius"], "Fillet radius"),
        name: optionalName(parameters, "VantageFillet"),
      });
    case "create_chamfer":
      return chamferFeature({
        edgeIds: requireEntityIds(parameters, ["edgeIds", "entities", "edges"], "edgeIds"),
        widthMm: requireNumber(parameters, ["widthMm", "width", "distance"], "Chamfer width"),
        name: optionalName(parameters, "VantageChamfer"),
      });
    case "create_shell":
      return buildShellFeature(parameters);
    case "create_hole":
      return buildHoleFeature(parameters);
    case "create_pattern":
      return buildPatternFeature(parameters);
    case "create_mirror":
      return mirrorFeature({
        featureIds: requireFeatureIds(parameters),
        plane: optionalString(parameters, ["plane"]) || "Right",
        planeIds: stringList(firstDefined(parameters, ["planeIds"])),
        name: optionalName(parameters, "VantageMirror"),
      });
    case "create_revolve":
      return revolveFeature({
        sketchFeatureId: firstPlannedId(parameters.sketchFeatureId),
        axisIds: requireEntityIds(parameters, ["axisIds", "entities", "edges"], "axisIds"),
        angleDeg: firstNumber(parameters, ["angleDeg", "angle"]),
        operationType: optionalExtrudeOperation(parameters),
        oppositeDirection: bool(parameters.oppositeDirection, false),
        name: optionalName(parameters, "VantageRevolve"),
      });
    case "create_boolean":
      return booleanFeature({
        operationType: requireBooleanOperation(parameters),
        toolBodyIds: requireEntityIds(parameters, ["toolBodyIds", "tools", "bodyIds"], "toolBodyIds"),
        targetBodyIds: stringList(firstDefined(parameters, ["targetBodyIds", "targets"])),
        name: optionalName(parameters, "VantageBoolean"),
      });
  }
}

/**
 * Native Shell (faces-to-remove). Face ids must already be resolved; this never
 * invents them or falls back to FeatureScript. The payload itself comes from
 * onshape-features so the MCP tool and this job path cannot drift apart.
 */
function buildShellFeature(parameters: Record<string, unknown>) {
  return shellFeature({
    faceIds: requireEntityIds(parameters, ["faceIds", "entities", "faces"], "faceIds"),
    thicknessMm: requireNumber(parameters, ["thicknessMm", "thickness"], "Shell thickness"),
    outward: bool(parameters.outward, false) || bool(parameters.oppositeDirection, false),
    name: optionalName(parameters, "VantageShell"),
  });
}

/**
 * Native Hole. Hosted holes are face + body picks from list-onshape-entities.
 * A pointSketchFeatureId alone is not a location — we never invent a point sketch.
 */
function buildHoleFeature(parameters: Record<string, unknown>) {
  const hasPointSketch = Boolean(optionalString(parameters, ["pointSketchFeatureId"]));
  const hasLocationIds = stringList(parameters.locationIds).length > 0;
  const hasFaceIds = stringList(parameters.faceIds).length > 0;
  if (hasPointSketch && !hasLocationIds && !hasFaceIds) {
    throw new Error(
      "Hosted holes need location face ids and body ids from list-onshape-entities. A pointSketchFeatureId is not enough — resolve those picks first.",
    );
  }
  return holeFeature({
    locationIds: requireEntityIds(parameters, ["locationIds", "locations", "vertices", "faceIds"], "locationIds"),
    scopeIds: requireEntityIds(parameters, ["scopeIds", "scope", "bodyIds", "bodies"], "scopeIds"),
    diameterMm: requireNumber(parameters, ["diameterMm", "diameter"], "Hole diameter"),
    endStyle: holeEndStyle(parameters),
    depthMm: firstNumber(parameters, ["depthMm", "depth"]),
    name: optionalName(parameters, "VantageHole"),
  });
}

function buildPatternFeature(parameters: Record<string, unknown>) {
  const featureIds = requireFeatureIds(parameters);
  const name = optionalName(parameters, undefined);
  if (isCircularPattern(parameters)) {
    const axisIds = stringList(firstDefined(parameters, ["axisIds", "axis"]));
    if (!axisIds.length) {
      throw new Error(
        "Circular pattern requires axisIds (resolved cylindrical-face ids). Resolve them first — Vantage will not invent an axis or generate FeatureScript.",
      );
    }
    return circularPatternFeature({
      featureIds,
      axisIds,
      instanceCount: requireNumber(parameters, ["instanceCount", "count"], "Pattern instanceCount"),
      angleDeg: firstNumber(parameters, ["angleDeg", "angle"]),
      equalSpacing: bool(parameters.equalSpacing, true),
      name,
    });
  }
  const directionIds = stringList(firstDefined(parameters, ["directionIds"]));
  return linearPatternFeature({
    featureIds,
    directionIds: directionIds.length ? directionIds : [patternAxisPlaneId(optionalString(parameters, ["direction"]) || "X")],
    spacingMm: requireNumber(parameters, ["spacingMm", "spacing"], "Pattern spacing"),
    instanceCount: requireNumber(parameters, ["instanceCount", "count"], "Pattern instanceCount"),
    oppositeDirection: bool(parameters.oppositeDirection, false),
    name,
  });
}

async function postNativeFeature(
  http: OnshapeNativeHttp,
  document: OnshapeNativeDocument,
  payload: unknown,
  idempotencyKey: string,
): Promise<string> {
  const response = await http(onshapeFeaturePath(document), {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "x-vantage-idempotency": idempotencyKey },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(`Onshape feature creation failed (HTTP ${response.status}): ${detailOf(body, response).slice(0, 400)}`);
  }
  return parseAddedFeatureId(body);
}

async function deleteNativeFeature(
  http: OnshapeNativeHttp,
  document: OnshapeNativeDocument,
  parameters: Record<string, unknown>,
  idempotencyKey: string,
): Promise<OnshapeNativeDispatchResult> {
  const featureId =
    firstPlannedId(parameters.featureId) ||
    firstPlannedId(parameters.featureid) ||
    firstPlannedId(parameters.id);
  if (!featureId) {
    throw new Error("delete_feature requires featureId; no feature was deleted");
  }
  const response = await http(onshapeFeaturePath(document, featureId), {
    method: "DELETE",
    headers: { "x-vantage-idempotency": idempotencyKey },
  });
  if (!response.ok) {
    const body = await readBody(response);
    throw new Error(`Onshape feature delete failed (HTTP ${response.status}): ${detailOf(body, response).slice(0, 400)}`);
  }
  return { featureId, featureScriptUsed: false };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 400) };
  }
}

function detailOf(body: unknown, response: Response): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.error_description;
    if (message !== undefined) return String(message);
  }
  return response.statusText || "Onshape request failed";
}

function isCircularPattern(parameters: Record<string, unknown>): boolean {
  const kind = optionalString(parameters, ["patternKind", "kind", "patternType", "type"]).toLowerCase();
  if (kind === "circular" || kind === "circularpattern" || kind === "circular_pattern") return true;
  if (kind === "linear" || kind === "linearpattern" || kind === "linear_pattern") return false;
  return stringList(firstDefined(parameters, ["axisIds", "axis"])).length > 0
    || Boolean(optionalString(parameters, ["axisFeatureId"]));
}

function requireFeatureIds(parameters: Record<string, unknown>): string[] {
  const listed = stringList(firstDefined(parameters, ["featureIds", "features"]));
  if (listed.length) return listed;
  const one = optionalString(parameters, ["featureId"]);
  if (one) return [one];
  throw new Error(
    "featureIds is empty. Resolve real geometry first (onshape_describe, or the tool's own featureId argument) — Vantage never guesses Onshape entity ids.",
  );
}

function requireEntityIds(parameters: Record<string, unknown>, names: string[], label: string): string[] {
  for (const name of names) {
    const ids = stringList(parameters[name]);
    if (ids.length) return ids;
  }
  throw new Error(
    `${label} is empty. Resolve real geometry first (onshape_describe, or the tool's own featureId argument) — Vantage never guesses Onshape entity ids.`,
  );
}

function optionalExtrudeOperation(parameters: Record<string, unknown>): ExtrudeOperation | undefined {
  const raw = optionalString(parameters, ["operationType"]).toUpperCase();
  if (!raw) return undefined;
  if (raw !== "NEW" && raw !== "ADD" && raw !== "REMOVE" && raw !== "INTERSECT") {
    throw new Error(`operationType must be one of NEW, ADD, REMOVE, INTERSECT. Got "${raw}".`);
  }
  return raw;
}

function requireBooleanOperation(parameters: Record<string, unknown>): BooleanOperation {
  const raw = optionalString(parameters, ["booleanType", "operationType"]).toUpperCase();
  if (raw !== "UNION" && raw !== "SUBTRACT" && raw !== "INTERSECT") {
    throw new Error(`Boolean needs operationType UNION, SUBTRACT, or INTERSECT.`);
  }
  return raw;
}

function holeEndStyle(parameters: Record<string, unknown>): HoleEndStyle {
  const raw = optionalString(parameters, ["endStyle"]).toUpperCase() || "THROUGH";
  if (raw !== "THROUGH" && raw !== "BLIND") {
    throw new Error(`endStyle must be one of THROUGH, BLIND. Got "${raw}".`);
  }
  return raw;
}

function optionalName(parameters: Record<string, unknown>, fallback: string | undefined): string | undefined {
  return optionalString(parameters, ["name"]) || fallback;
}

function optionalString(parameters: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const raw = parameters[name];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return "";
}

function firstDefined(parameters: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (parameters[name] !== undefined) return parameters[name];
  }
  return undefined;
}

function firstNumber(parameters: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const parsed = parseNumber(parameters[name]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function requireNumber(parameters: Record<string, unknown>, names: string[], label: string): number {
  const value = firstNumber(parameters, names);
  if (value === undefined) {
    throw new Error(`${label} is required; no geometry was created`);
  }
  return value;
}

function parseNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const match = raw.trim().match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}
