/**
 * Resolve real Onshape entity ids before building a feature that selects geometry.
 *
 * Fillet, chamfer, hole, and the patterns all take *queries*. Guessing an edge id
 * is not possible and inventing one would be a fabricated result, so instead we
 * evaluate a read-only FeatureScript lambda against the live Part Studio:
 *
 *   POST /partstudios/d/{did}/w/{wid}/e/{eid}/featurescript
 *   { "script": "function(context is Context, queries) { … }", "queries": [] }
 *
 * `transientQueriesToStrings(evaluateQuery(context, q))` returns deterministic id
 * strings which are valid in a subsequent addFeature call. The endpoint does not
 * modify the document — it only reads the regenerated context.
 *
 * Every helper returns [] rather than throwing when the query matches nothing, so
 * a caller can report an honest "no edges matched" instead of a stack trace.
 */

import { onshapePlaneNormal } from "./onshape-features";

export type OnshapeResolveHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeDocumentIds = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export const ONSHAPE_ENTITY_TYPES = ["VERTEX", "EDGE", "FACE", "BODY"] as const;
export type OnshapeEntityType = (typeof ONSHAPE_ENTITY_TYPES)[number];

const FS_SERIALIZATION_VERSION = "1.1.22";

function featurescriptPath(document: OnshapeDocumentIds): string {
  return `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}/featurescript`;
}

function safeFeatureId(featureId: string): string {
  const id = String(featureId ?? "").trim();
  // Feature ids are Onshape-generated tokens; anything else is a caller bug or an
  // injection attempt into the FeatureScript source we are about to send.
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) {
    throw new Error(`"${id}" is not a valid Onshape feature id. Use the featureId returned by a previous tool call.`);
  }
  return id;
}

/**
 * Walk an arbitrary BTFSValue tree and collect every string leaf. Onshape wraps
 * results as BTFSValueArray-2125 / BTFSValueString-1358, but tolerating any shape
 * keeps this working across serialization-version bumps.
 */
export function collectFeatureScriptStrings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || out.length > 5_000) return out;
  if (typeof node === "string") {
    if (node.trim()) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectFeatureScriptStrings(item, out, depth + 1);
    return out;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    // "typeTag" / "btType" are metadata, never entity ids.
    for (const [key, value] of Object.entries(record)) {
      if (key === "btType" || key === "typeTag" || key === "message") continue;
      collectFeatureScriptStrings(value, out, depth + 1);
    }
  }
  return out;
}

export type FeatureScriptEvalResult = {
  ids: string[];
  notices: string[];
};

/** Evaluate one FeatureScript lambda and return the deterministic id strings it produced. */
export async function evaluateOnshapeQuery(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  script: string,
): Promise<FeatureScriptEvalResult> {
  const response = await http(featurescriptPath(document), {
    method: "POST",
    body: JSON.stringify({ script, queries: [], serializationVersion: FS_SERIALIZATION_VERSION }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Onshape FeatureScript evaluation returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    const message =
      (body as { message?: string })?.message ?? (typeof body === "string" ? body : JSON.stringify(body ?? {}));
    throw new Error(`Onshape could not evaluate the geometry query (HTTP ${response.status}): ${String(message).slice(0, 300)}`);
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const notices = Array.isArray(record.notices)
    ? record.notices
        .map((notice) => String((notice as { message?: unknown })?.message ?? ""))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const ids = [...new Set(collectFeatureScriptStrings(record.result))];
  return { ids, notices };
}

// ---------------------------------------------------------------------------
// Script builders
// ---------------------------------------------------------------------------

export function createdByScript(featureId: string, entityType: OnshapeEntityType): string {
  const id = safeFeatureId(featureId);
  return `function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${id}"), EntityType.${entityType}))); }`;
}

/**
 * Straight edges of a feature whose direction is (anti)parallel to `axis`.
 * This is how "fillet the four corners of this plate" becomes an exact selection:
 * the corner edges of an extrude are the ones parallel to the extrude direction.
 */
export function parallelEdgesScript(featureId: string, axis: readonly [number, number, number]): string {
  const id = safeFeatureId(featureId);
  const [ax, ay, az] = axis.map((value) => {
    if (!Number.isFinite(value)) throw new Error("Axis components must be finite numbers.");
    return Number(value);
  }) as [number, number, number];
  return [
    "function(context is Context, queries) {",
    `  var edges = evaluateQuery(context, qGeometry(qCreatedBy(makeId("${id}"), EntityType.EDGE), GeometryType.LINE));`,
    `  var axis = normalize(vector(${ax}, ${ay}, ${az}));`,
    "  var kept = [];",
    "  for (var edge in edges) {",
    '    var line = evEdgeTangentLine(context, { "edge" : edge, "parameter" : 0.5 });',
    "    if (abs(dot(line.direction, axis)) > 0.99) { kept = append(kept, edge); }",
    "  }",
    "  return transientQueriesToStrings(kept);",
    "}",
  ].join("\n");
}

/**
 * Planar faces of a feature whose outward normal points along `axis`.
 *
 * This is what turns "shell this box, open at the top" into an exact face pick.
 * Shell takes the faces to *remove*, and there is no way to name one without
 * measuring it: `evFaceTangentPlane` gives the outward normal at the face centre,
 * and a dot product against the requested direction selects it. Same shape as
 * parallelEdgesScript, which picks corner edges the same way.
 */
export function facesFacingScript(featureId: string, axis: readonly [number, number, number]): string {
  const id = safeFeatureId(featureId);
  const [ax, ay, az] = axis.map((value) => {
    if (!Number.isFinite(value)) throw new Error("Axis components must be finite numbers.");
    return Number(value);
  }) as [number, number, number];
  return [
    "function(context is Context, queries) {",
    `  var faces = evaluateQuery(context, qGeometry(qCreatedBy(makeId("${id}"), EntityType.FACE), GeometryType.PLANE));`,
    `  var axis = normalize(vector(${ax}, ${ay}, ${az}));`,
    "  var kept = [];",
    "  for (var face in faces) {",
    '    var plane = evFaceTangentPlane(context, { "face" : face, "parameter" : vector(0.5, 0.5) });',
    "    if (dot(plane.normal, axis) > 0.99) { kept = append(kept, face); }",
    "  }",
    "  return transientQueriesToStrings(kept);",
    "}",
  ].join("\n");
}

/**
 * Straight line edges a sketch created — the axis a revolve turns about.
 *
 * A human revolving a roller draws the profile and a centreline, then picks the
 * centreline. There is no way to guess which line that is, so the caller names the
 * sketch and this returns its lines; a sketch with exactly one line is unambiguous
 * and anything else is reported back rather than picked at random.
 */
export function sketchLinesScript(sketchFeatureId: string): string {
  const id = safeFeatureId(sketchFeatureId);
  return `function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qGeometry(qCreatedBy(makeId("${id}"), EntityType.EDGE), GeometryType.LINE))); }`;
}

/** Cylindrical faces created by a feature — the axis input for a circular pattern. */
export function cylindricalFacesScript(featureId: string): string {
  const id = safeFeatureId(featureId);
  return `function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qGeometry(qCreatedBy(makeId("${id}"), EntityType.FACE), GeometryType.CYLINDER))); }`;
}

export const ALL_SOLID_BODIES_SCRIPT =
  "function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qAllSolidBodies())); }";

// ---------------------------------------------------------------------------
// Typed resolvers
// ---------------------------------------------------------------------------

export type EdgeSelection = "all" | "corners";

/**
 * Edge ids for a fillet / chamfer.
 * - "all": every edge the feature created.
 * - "corners": only the straight edges parallel to the sketch plane normal —
 *   the vertical corners of an extruded plate.
 */
export async function resolveOnshapeEdgeIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  input: { featureId: string; selection?: EdgeSelection; plane?: string },
): Promise<string[]> {
  const selection = input.selection ?? "all";
  const script =
    selection === "corners"
      ? parallelEdgesScript(input.featureId, onshapePlaneNormal(input.plane ?? "Top"))
      : createdByScript(input.featureId, "EDGE");
  const { ids } = await evaluateOnshapeQuery(http, document, script);
  return ids;
}

export async function resolveOnshapeVertexIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  featureId: string,
): Promise<string[]> {
  const { ids } = await evaluateOnshapeQuery(http, document, createdByScript(featureId, "VERTEX"));
  return ids;
}

export async function resolveOnshapeSolidBodyIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  featureId?: string,
): Promise<string[]> {
  const script = featureId ? createdByScript(featureId, "BODY") : ALL_SOLID_BODIES_SCRIPT;
  const { ids } = await evaluateOnshapeQuery(http, document, script);
  return ids;
}

export async function resolveOnshapeAxisIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  featureId: string,
): Promise<string[]> {
  const { ids } = await evaluateOnshapeQuery(http, document, cylindricalFacesScript(featureId));
  return ids;
}

/** Faces of a feature pointing along a world direction — the faces a shell removes. */
export async function resolveOnshapeFaceIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  input: { featureId: string; facing: readonly [number, number, number] },
): Promise<string[]> {
  const { ids } = await evaluateOnshapeQuery(http, document, facesFacingScript(input.featureId, input.facing));
  return ids;
}

/** Straight lines a sketch drew — candidate revolve axes. */
export async function resolveOnshapeSketchLineIds(
  http: OnshapeResolveHttp,
  document: OnshapeDocumentIds,
  sketchFeatureId: string,
): Promise<string[]> {
  const { ids } = await evaluateOnshapeQuery(http, document, sketchLinesScript(sketchFeatureId));
  return ids;
}
