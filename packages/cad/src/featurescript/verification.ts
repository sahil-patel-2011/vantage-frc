/**
 * The standard two-call verification pull after inserting the part feature:
 * one bounding-box readback and one iso view.
 *
 * The alternative — describing geometry by asking Onshape a question per face —
 * is what burns the annual API-key quota. Both calls here are the SESSION-REST
 * kind the agent already makes, and together they answer "did it build what I
 * asked for" without a single extra query.
 *
 * Everything in this file is a pure string/path builder. Nothing fetches.
 */

import type { GeneratedIdBinding } from "./generate";

export type PartStudioRef = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

/** Same validation rule as onshape-resolve.safeFeatureId — a feature id is an Onshape token. */
function safeFeatureId(featureId: string): string {
  const id = String(featureId ?? "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) {
    throw new Error(`"${id}" is not a valid Onshape feature id. Use the featureId returned when the feature was inserted.`);
  }
  return id;
}

function safeSubId(subId: string): string {
  const token = String(subId ?? "").trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(token)) {
    throw new Error(`"${token}" is not a FeatureScript sub-id emitted by this generator.`);
  }
  return token;
}

/**
 * Read-only FeatureScript that returns the part's tight bounding box as six
 * strings, in millimetres, in the order minX, minY, minZ, maxX, maxY, maxZ.
 *
 * Strings (not numbers) because the evaluation endpoint's result is walked by
 * onshape-resolve.collectFeatureScriptStrings, which collects string leaves.
 * `evBox3d(context, { "topology" : …, "tight" : true })` returning a Box3d with
 * `minCorner` / `maxCorner` is the documented bounding-box evaluation
 * (https://cad.onshape.com/FsDoc/library.html); dividing a ValueWithUnits by
 * `millimeter` yields the unitless millimetre magnitude.
 */
export function boundingBoxScript(featureId?: string): string {
  const scope = featureId
    ? `qOwnedByBody(qCreatedBy(makeId("${safeFeatureId(featureId)}"), EntityType.BODY), EntityType.BODY)`
    : "qAllSolidBodies()";
  return [
    "function(context is Context, queries) {",
    `  var bodies = evaluateQuery(context, ${scope});`,
    "  if (size(bodies) == 0) { return []; }",
    '  var box = evBox3d(context, { "topology" : qUnion(bodies), "tight" : true });',
    "  return [",
    "    toString(box.minCorner[0] / millimeter), toString(box.minCorner[1] / millimeter), toString(box.minCorner[2] / millimeter),",
    "    toString(box.maxCorner[0] / millimeter), toString(box.maxCorner[1] / millimeter), toString(box.maxCorner[2] / millimeter)",
    "  ];",
    "}",
  ].join("\n");
}

export type BoundingBoxReadback = {
  minXMm: number;
  minYMm: number;
  minZMm: number;
  maxXMm: number;
  maxYMm: number;
  maxZMm: number;
  sizeMm: { xMm: number; yMm: number; zMm: number };
};

/**
 * Parse the six strings back into millimetres. Returns null when Onshape
 * returned nothing parseable — an empty Part Studio, or a FeatureScript error —
 * so the caller reports "no bounding box available" instead of a made-up size.
 */
export function parseBoundingBoxReadback(ids: readonly string[]): BoundingBoxReadback | null {
  if (ids.length < 6) return null;
  const numbers = ids.slice(0, 6).map((value) => Number(String(value).trim()));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [minXMm, minYMm, minZMm, maxXMm, maxYMm, maxZMm] = numbers as [number, number, number, number, number, number];
  if (maxXMm < minXMm || maxYMm < minYMm || maxZMm < minZMm) return null;
  return {
    minXMm,
    minYMm,
    minZMm,
    maxXMm,
    maxYMm,
    maxZMm,
    sizeMm: { xMm: maxXMm - minXMm, yMm: maxYMm - minYMm, zMm: maxZMm - minZMm },
  };
}

/** How far the built part drifts from what the dry run predicted, per axis. */
export function compareBoundingBox(
  predicted: { xMm: number; yMm: number; zMm: number },
  measured: BoundingBoxReadback,
): { xMm: number; yMm: number; zMm: number; worstMm: number } {
  const xMm = measured.sizeMm.xMm - predicted.xMm;
  const yMm = measured.sizeMm.yMm - predicted.yMm;
  const zMm = measured.sizeMm.zMm - predicted.zMm;
  return { xMm, yMm, zMm, worstMm: Math.max(Math.abs(xMm), Math.abs(yMm), Math.abs(zMm)) };
}

/**
 * Onshape's isometric shaded-view matrix, as a 3x4 row-major transform.
 *
 * Value taken from Onshape's own forum guidance on the shaded-views transform
 * (https://forum.onshape.com/discussion/19931/shaded-views-api-transformation-matrix-zoom),
 * where the matrix sets direction and pan while `pixelSize` sets the zoom — and
 * `pixelSize=0` fills the frame with the model, which is what we want for a
 * one-shot "show me what you built".
 */
export const ISO_VIEW_MATRIX = "0.612,0.612,0,0,-0.354,0.354,0.707,0,0.707,-0.707,0.707,0" as const;

export type IsoViewOptions = {
  widthPx?: number;
  heightPx?: number;
  /** 0 fits the model to the frame. Any other value is millimetres per pixel. */
  pixelSize?: number;
};

/**
 * Path for GET …/partstudios/d/{did}/w/{wid}/e/{eid}/shadedviews — one image,
 * one call. The `viewMatrix` query parameter also accepts named views such as
 * "top"; the iso matrix above is used so the render shows depth.
 */
export function isoShadedViewPath(document: PartStudioRef, options: IsoViewOptions = {}): string {
  const width = Math.round(options.widthPx ?? 700);
  const height = Math.round(options.heightPx ?? 700);
  if (!Number.isFinite(width) || width < 32 || width > 2_000 || !Number.isFinite(height) || height < 32 || height > 2_000) {
    throw new Error("Shaded-view width and height must be between 32 and 2000 pixels.");
  }
  const pixelSize = Number(options.pixelSize ?? 0);
  if (!Number.isFinite(pixelSize) || pixelSize < 0) throw new Error("pixelSize must be 0 (fit to frame) or a positive number.");
  const query = new URLSearchParams({
    outputWidth: String(width),
    outputHeight: String(height),
    pixelSize: String(pixelSize),
    viewMatrix: ISO_VIEW_MATRIX,
    useAntiAliasing: "true",
    includeSurfaces: "false",
  });
  return `/partstudios/d/${document.documentId}/w/${document.workspaceId}/e/${document.elementId}/shadedviews?${query.toString()}`;
}

/**
 * Read-only FeatureScript that resolves one of the generator's deterministic
 * sub-ids to real entity ids, using the same mechanism as
 * onshape-resolve.createdByScript: `qCreatedBy(makeId(featureId) + "sub", …)`
 * with `transientQueriesToStrings`.
 *
 * `index` fills the `<index>` placeholder of an indexed binding — the loop index
 * of the pattern instance, counting from 0 in the order the generator predicted.
 */
export function subIdCreatedByScript(featureId: string, binding: GeneratedIdBinding, index?: number): string {
  const id = safeFeatureId(featureId);
  const path = binding.subIds.map((subId) => {
    if (subId !== "<index>") return safeSubId(subId);
    if (!Number.isInteger(index) || (index as number) < 0) {
      throw new Error(`"${binding.token}" is an indexed binding — pass the 0-based instance index to resolve one of its entities.`);
    }
    return String(index);
  });
  const appended = path.map((subId) => ` + "${subId}"`).join("");
  return `function(context is Context, queries) { return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${id}")${appended}, EntityType.${binding.entityType}))); }`;
}

/** The two verification calls, named, so a caller can budget them before spending. */
export type VerificationPlan = {
  boundingBox: { kind: "featurescript"; script: string };
  isoView: { kind: "shadedview"; path: string };
  onshapeCalls: 2;
};

export function planVerification(document: PartStudioRef, featureId?: string, view: IsoViewOptions = {}): VerificationPlan {
  return {
    boundingBox: { kind: "featurescript", script: boundingBoxScript(featureId) },
    isoView: { kind: "shadedview", path: isoShadedViewPath(document, view) },
    onshapeCalls: 2,
  };
}
