/**
 * Native Onshape feature update — change depth/width on a feature that was
 * already created, then POST …/features/featureid/{fid}.
 *
 * This is the human re-run path: no FeatureScript, no cad_part_edit, no
 * invented ids. The featureId must be the one Onshape returned from create.
 */

import {
  ONSHAPE_SERIALIZATION_VERSION,
  onshapeFeaturePath,
  parseAddedFeatureId,
  quantityParameter,
  rectangleSketchFeature,
} from "./onshape-features";

export type OnshapeUpdateFeatureHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeUpdateFeatureDocument = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export type OnshapeNativeDimensionPatch = {
  depthMm?: unknown;
  widthMm?: unknown;
  heightMm?: unknown;
};

const DEMO_FEATURE_ID = /demo/i;

export function requireCreatedOnshapeFeatureId(featureId: unknown): string {
  const id = String(featureId ?? "").trim();
  if (!id) {
    throw new Error(
      "Updating a native feature needs the featureId Onshape returned when it was created.",
    );
  }
  if (DEMO_FEATURE_ID.test(id)) {
    throw new Error(
      "Refusing DEMO feature id. Pass the featureId Onshape returned from a prior create.",
    );
  }
  return id;
}

function optionalPositiveMm(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const mm = Number(value);
  if (!Number.isFinite(mm) || mm <= 0 || mm > 10_000) {
    throw new Error(`${label} must be a positive number of millimetres (max 10000). Got ${String(value)}.`);
  }
  return mm;
}

function required(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapFeature(body: unknown): {
  feature: Record<string, unknown>;
  sourceMicroversion?: string;
  serializationVersion?: string;
} {
  const root = asRecord(body) ?? {};
  const raw = root.feature ?? root;
  const wrapped = asRecord(raw);
  if (!wrapped) {
    throw new Error(
      "Onshape did not return the existing feature. Create the native feature first and pass the featureId from that create.",
    );
  }
  const message = asRecord(wrapped.message);
  const feature = message ?? wrapped;
  if (!feature.featureType && !feature.btType && !Array.isArray(feature.parameters) && !Array.isArray(feature.entities)) {
    throw new Error(
      "Onshape did not return the existing feature. Create the native feature first and pass the featureId from that create.",
    );
  }
  const sourceMicroversion = String(
    root.sourceMicroversion ?? root.microversionId ?? wrapped.sourceMicroversion ?? "",
  ).trim();
  const serializationVersion = String(
    root.serializationVersion ?? wrapped.serializationVersion ?? ONSHAPE_SERIALIZATION_VERSION,
  ).trim();
  return {
    feature,
    ...(sourceMicroversion ? { sourceMicroversion } : {}),
    serializationVersion,
  };
}

function parameterList(feature: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(feature.parameters)
    ? feature.parameters.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
}

function replaceQuantity(
  parameters: Array<Record<string, unknown>>,
  parameterId: string,
  mm: number,
): Array<Record<string, unknown>> {
  const next = quantityParameter(parameterId, mm, mm / 1000);
  const index = parameters.findIndex((entry) => String(entry.parameterId ?? "") === parameterId);
  if (index >= 0) {
    const copy = parameters.slice();
    copy[index] = { ...parameters[index], ...next };
    return copy;
  }
  return [...parameters, next];
}

function planeFromFeature(feature: Record<string, unknown>): string {
  const plane = parameterList(feature).find((entry) => String(entry.parameterId ?? "") === "sketchPlane");
  const query = Array.isArray(plane?.queries) ? asRecord(plane.queries[0]) : null;
  const id = Array.isArray(query?.deterministicIds) ? String(query.deterministicIds[0] ?? "") : "";
  if (id === "JCC") return "Front";
  if (id === "JEC") return "Right";
  return "Top";
}

function metresToMm(value: unknown): number | undefined {
  const metres = Number(value);
  if (!Number.isFinite(metres)) return undefined;
  return metres * 1000;
}

function inferRectangleMm(feature: Record<string, unknown>): {
  originXMm: number;
  originYMm: number;
  widthMm: number;
  heightMm: number;
} | null {
  const entities = Array.isArray(feature.entities) ? feature.entities : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of entities) {
    const entity = asRecord(raw);
    if (!entity) continue;
    const id = String(entity.entityId ?? "");
    if (id) byId.set(id, entity);
  }
  const bottom = byId.get("rect.bottom");
  const right = byId.get("rect.right");
  if (!bottom || !right) return null;
  const geometry = asRecord(bottom.geometry);
  const originXMm = metresToMm(geometry?.pntX) ?? 0;
  const originYMm = metresToMm(geometry?.pntY) ?? 0;
  const widthMm = metresToMm(bottom.endParam);
  const heightMm = metresToMm(right.endParam);
  if (widthMm === undefined || heightMm === undefined || widthMm <= 0 || heightMm <= 0) return null;
  return { originXMm, originYMm, widthMm, heightMm };
}

export function applyNativeFeatureDimensions(
  feature: Record<string, unknown>,
  patch: { depthMm?: number; widthMm?: number; heightMm?: number },
): Record<string, unknown> {
  const featureType = String(feature.featureType ?? "");
  const isSketch = featureType === "newSketch" || feature.btType === "BTMSketch-151" || Array.isArray(feature.entities);
  let next: Record<string, unknown> = { ...feature };
  let applied = false;

  if (patch.depthMm !== undefined) {
    if (isSketch && featureType === "newSketch") {
      throw new Error("depthMm updates an extrude. Pass the extrude featureId from the prior create.");
    }
    next = { ...next, parameters: replaceQuantity(parameterList(next), "depth", patch.depthMm) };
    applied = true;
  }

  if (patch.widthMm !== undefined || patch.heightMm !== undefined) {
    if (isSketch) {
      const inferred = inferRectangleMm(feature);
      const widthMm = patch.widthMm ?? inferred?.widthMm;
      const heightMm = patch.heightMm ?? inferred?.heightMm;
      if (widthMm === undefined || heightMm === undefined) {
        throw new Error(
          "Updating a sketch needs both width and height (or a prior rectangle so the missing side can be kept).",
        );
      }
      const rebuilt = rectangleSketchFeature({
        name: String(feature.name ?? "VantageSketch"),
        plane: planeFromFeature(feature),
        widthMm,
        heightMm,
        originXMm: inferred?.originXMm ?? 0,
        originYMm: inferred?.originYMm ?? 0,
      });
      next = {
        ...next,
        ...rebuilt.feature,
        featureId: feature.featureId,
        name: feature.name ?? rebuilt.feature.name,
      };
      applied = true;
    } else if (patch.widthMm !== undefined) {
      next = { ...next, parameters: replaceQuantity(parameterList(next), "width", patch.widthMm) };
      applied = true;
    } else {
      throw new Error("heightMm updates a sketch. Pass the sketch featureId from the prior create.");
    }
  }

  if (!applied) {
    throw new Error("Provide depthMm and/or widthMm to update the existing native feature.");
  }
  return next;
}

/**
 * GET the existing native feature, patch depth/width, POST the Onshape update API.
 * Returns the feature id Onshape put on the update response — never a synthesized id.
 */
export async function updateOnshapeFeature(
  http: OnshapeUpdateFeatureHttp,
  input: {
    document: OnshapeUpdateFeatureDocument;
    featureId: unknown;
  } & OnshapeNativeDimensionPatch,
): Promise<{ featureId: string; featureScriptUsed: false }> {
  const featureId = requireCreatedOnshapeFeatureId(input.featureId);
  const document = {
    documentId: required(input.document?.documentId, "documentId"),
    workspaceId: required(input.document?.workspaceId, "workspaceId"),
    elementId: required(input.document?.elementId, "elementId"),
  };
  const depthMm = optionalPositiveMm(input.depthMm, "depthMm");
  const widthMm = optionalPositiveMm(input.widthMm, "widthMm");
  const heightMm = optionalPositiveMm(input.heightMm, "heightMm");
  if (depthMm === undefined && widthMm === undefined && heightMm === undefined) {
    throw new Error("Provide depthMm and/or widthMm to update the existing native feature.");
  }

  const path = onshapeFeaturePath(document, featureId);
  const existingResponse = await http(path);
  const existingBody = await readBody(existingResponse);
  if (!existingResponse.ok) {
    throw new Error(
      `Onshape feature ${featureId} was not found (HTTP ${existingResponse.status}): ${detailOf(existingBody, existingResponse).slice(0, 400)}. Create the native feature first and pass the featureId Onshape returned.`,
    );
  }

  const { feature, sourceMicroversion, serializationVersion } = unwrapFeature(existingBody);
  const patched = applyNativeFeatureDimensions(feature, { depthMm, widthMm, heightMm });
  patched.featureId = featureId;

  const updateResponse = await http(path, {
    method: "POST",
    body: JSON.stringify({
      btType: "BTFeatureDefinitionCall-1406",
      feature: patched,
      serializationVersion: serializationVersion ?? ONSHAPE_SERIALIZATION_VERSION,
      ...(sourceMicroversion ? { sourceMicroversion } : {}),
      rejectMicroversionSkew: false,
    }),
  });
  const updateBody = await readBody(updateResponse);
  if (!updateResponse.ok) {
    throw new Error(
      `Onshape feature update failed (HTTP ${updateResponse.status}): ${detailOf(updateBody, updateResponse).slice(0, 400)}`,
    );
  }
  return { featureId: parseAddedFeatureId(updateBody), featureScriptUsed: false };
}
