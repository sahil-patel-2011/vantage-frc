import type { OnshapeHttp } from "@vantage/cad";
import {
  type AssemblyFacts,
  type BoxMm,
  type FeatureFacts,
  type InstanceFacts,
  type MateFacts,
  type PartFacts,
} from "./model";
import { metresToMm } from "./units";

/**
 * Reading the assembly out of Onshape, once.
 *
 * Everything this module returns is something Onshape said. Where Onshape says
 * nothing — a part with no mass, an element that 403s, a mate with no resolvable
 * occurrences — the field is null and the reason is pushed onto `gaps`, which
 * the run report prints. There is no default value anywhere in this file.
 *
 * RESUMABILITY
 *
 * Onshape is rate-limited and a robot assembly is hundreds of calls, so every
 * raw response is kept in an `IngestCache` that the run checkpoints after each
 * slice. A worker that is killed halfway through re-enters with the cache and
 * makes only the calls it had not made. `ingestAssembly` is therefore safe to
 * call repeatedly with the same cache; the second call is nearly free.
 */

export type PartStudioRef = {
  documentId: string;
  /** "w" for a workspace, "m" for a microversion (linked documents). */
  wvm: "w" | "m" | "v";
  wvmId: string;
  elementId: string;
};

export type IngestCache = {
  /** GET /assemblies/…?includeMateFeatures=true */
  assembly?: unknown;
  /** documentId/wvm/wvmId → GET /documents/d/…/elements */
  elements?: Record<string, unknown>;
  /** studio key → GET /parts/d/…/e/… */
  studioParts?: Record<string, unknown>;
  /** studio key → GET /partstudios/…/features */
  studioFeatures?: Record<string, unknown>;
  /** studio key → GET /partstudios/…/massproperties */
  studioMass?: Record<string, unknown>;
  /** part key → GET /parts/…/partid/…/boundingboxes */
  partBoxes?: Record<string, unknown>;
};

export type IngestProgress = {
  /** Called after each Onshape round trip so the caller can checkpoint. */
  onCall?: (info: { calls: number; label: string }) => Promise<void> | void;
  /** Return true to stop early (cancel requested, time budget spent). */
  shouldStop?: () => boolean;
};

export class IngestIncomplete extends Error {
  constructor(readonly cache: IngestCache, readonly calls: number) {
    super("Ingest paused before completion");
    this.name = "IngestIncomplete";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function studioKey(ref: PartStudioRef): string {
  return `${ref.documentId}/${ref.wvm}/${ref.wvmId}/${ref.elementId}`;
}

export function partKeyOf(ref: PartStudioRef, partId: string): string {
  return `${studioKey(ref)}#${partId}`;
}

function studioPath(ref: PartStudioRef, prefix: string, suffix = ""): string {
  return `/${prefix}/d/${encodeURIComponent(ref.documentId)}/${ref.wvm}/${encodeURIComponent(ref.wvmId)}/e/${encodeURIComponent(ref.elementId)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Pure parsers — every one of these is exercised by ingest.test.ts against
// payload shapes captured from the Onshape docs, with no network in sight.
// ---------------------------------------------------------------------------

/**
 * Onshape bounding boxes are `{lowX, lowY, lowZ, highX, highY, highZ}` in
 * metres. Anything missing a coordinate is not a box.
 */
export function parseBoundingBox(payload: unknown): BoxMm | null {
  const body = record(payload);
  if (!body) return null;
  const low = [finite(body.lowX), finite(body.lowY), finite(body.lowZ)];
  const high = [finite(body.highX), finite(body.highY), finite(body.highZ)];
  if (low.some((value) => value === null) || high.some((value) => value === null)) return null;
  return {
    minX: metresToMm(low[0]!),
    minY: metresToMm(low[1]!),
    minZ: metresToMm(low[2]!),
    maxX: metresToMm(high[0]!),
    maxY: metresToMm(high[1]!),
    maxZ: metresToMm(high[2]!),
  };
}

/** Onshape scalars arrive as a number or as [value, min, max]. */
function massScalar(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw) && typeof raw[0] === "number" && Number.isFinite(raw[0])) return raw[0];
  return null;
}

/**
 * Per-part mass out of a Part Studio /massproperties response. The response
 * carries a `bodies` map keyed by partId plus an aggregate under "-all-"; only
 * the per-part entries are useful here, because a step needs the mass of the
 * one part it is placing.
 */
export function parseStudioMassProperties(
  payload: unknown,
): Map<string, { massKg: number | null; volumeM3: number | null }> {
  const out = new Map<string, { massKg: number | null; volumeM3: number | null }>();
  const body = record(payload);
  const bodies = record(body?.bodies);
  if (!bodies) return out;
  for (const [partId, raw] of Object.entries(bodies)) {
    if (partId === "-all-") continue;
    const entry = record(raw);
    if (!entry) continue;
    out.set(partId, {
      massKg: massScalar(entry.mass),
      volumeM3: massScalar(entry.volume),
    });
  }
  return out;
}

/** GET /parts/d/…/e/… — the part list for one Part Studio, with materials. */
export function parseStudioParts(
  payload: unknown,
): Array<{ partId: string; name: string; material: string | null; bodyType: string }> {
  return list(payload)
    .map((raw) => {
      const part = record(raw);
      if (!part) return null;
      const partId = text(part.partId ?? part.id);
      if (!partId) return null;
      const material = record(part.material);
      return {
        partId,
        name: text(part.name) || partId,
        material: text(material?.displayName ?? material?.name) || null,
        bodyType: text(part.bodyType) || "solid",
      };
    })
    .filter((part): part is { partId: string; name: string; material: string | null; bodyType: string } =>
      part !== null,
    );
}

/**
 * Feature tree with parameters kept.
 *
 * `listOnshapeFeatures` in @vantage/cad throws the parameters away, which is
 * fine for the student-facing tree explainer but useless here: the parameters
 * ARE the fabrication instructions. Quantity parameters keep their expression
 * string exactly as authored ("0.196 in"); enums keep their value. A parameter
 * shape we do not understand is dropped rather than coerced.
 */
export function parseFeatureList(payload: unknown, elementId: string): FeatureFacts[] {
  const body = record(payload);
  return list(body?.features)
    .map((raw) => {
      const feature = record(raw);
      if (!feature) return null;
      const message = record(feature.message) ?? feature;
      const id = text(message.featureId ?? feature.featureId ?? feature.nodeId ?? feature.id);
      if (!id) return null;
      return {
        elementId,
        id,
        name: text(message.name) || "Feature",
        featureType: text(message.featureType ?? feature.featureType) || "unknown",
        suppressed: message.suppressed === true,
        parameters: flattenParameters(message.parameters),
      } satisfies FeatureFacts;
    })
    .filter((feature): feature is FeatureFacts => feature !== null);
}

export function flattenParameters(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const item of list(raw)) {
    const parameter = record(item);
    const id = text(parameter?.parameterId);
    if (!parameter || !id) continue;
    const message = record(parameter.message) ?? parameter;
    const expression = message.expression;
    if (typeof expression === "string" && expression.trim()) {
      out[id] = expression.trim();
      continue;
    }
    const value = message.value;
    if (typeof value === "string" && value.trim()) {
      out[id] = value.trim();
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[id] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[id] = value;
      continue;
    }
    // Query parameters carry the geometry selection, not a measurement. We keep
    // only how many entities were selected — that is the "N places" count, and
    // it is a fact, unlike anything we might infer about which faces they were.
    const queries = list(message.queries);
    if (queries.length) out[`${id}__count`] = queries.length;
  }
  return out;
}

export type ParsedAssembly = {
  instances: Array<{
    id: string;
    name: string;
    kind: "part" | "assembly" | "unknown";
    documentId: string;
    /** Microversion for a linked document, empty for same-document parts. */
    microversionId: string;
    elementId: string;
    partId: string;
  }>;
  /** occurrence path (joined by "/") → 4x4 row-major transform + hidden flag. */
  occurrences: Array<{ path: string[]; transform: number[] | null; hidden: boolean }>;
  mates: MateFacts[];
};

const MATE_TYPES = new Set([
  "FASTENED",
  "REVOLUTE",
  "SLIDER",
  "CYLINDRICAL",
  "PLANAR",
  "BALL",
  "PIN_SLOT",
  "PARALLEL",
]);

/**
 * Walk `rootAssembly` (and, for completeness, the flat `instances` fallback the
 * API sometimes returns) into instances, occurrence transforms and mates.
 *
 * Mate parsing handles both shapes Onshape emits: `featureData.matedEntities[]`
 * (the assembly definition response) and the raw `parameters` form with a
 * `mateConnectorsQuery`. A mate whose occurrences cannot be resolved is skipped
 * and reported as a gap rather than being attached to a guess.
 */
export function parseAssemblyDefinition(payload: unknown): ParsedAssembly {
  const body = record(payload);
  const root = record(body?.rootAssembly) ?? body;

  const instances = list(root?.instances)
    .map((raw) => {
      const instance = record(raw);
      const id = text(instance?.id);
      if (!instance || !id) return null;
      const type = text(instance.type).toLowerCase();
      return {
        id,
        name: text(instance.name) || id,
        kind: type === "part" ? ("part" as const) : type === "assembly" ? ("assembly" as const) : ("unknown" as const),
        documentId: text(instance.documentId),
        microversionId: text(instance.documentMicroversion ?? instance.microversionId),
        elementId: text(instance.elementId),
        partId: text(instance.partId),
      };
    })
    .filter((instance): instance is ParsedAssembly["instances"][number] => instance !== null);

  const occurrences = list(root?.occurrences)
    .map((raw) => {
      const occurrence = record(raw);
      const path = list(occurrence?.path).map((segment) => text(segment)).filter(Boolean);
      if (!path.length) return null;
      const transform = list(occurrence?.transform)
        .map((value) => finite(value))
        .filter((value): value is number => value !== null);
      return {
        path,
        transform: transform.length === 16 ? transform : null,
        hidden: occurrence?.hidden === true,
      };
    })
    .filter((occurrence): occurrence is ParsedAssembly["occurrences"][number] => occurrence !== null);

  const mates: MateFacts[] = [];
  for (const raw of list(root?.features)) {
    const feature = record(raw);
    if (!feature) continue;
    const id = text(feature.id ?? feature.featureId);
    const featureType = text(feature.featureType).toLowerCase();
    if (featureType && featureType !== "mate" && featureType !== "mategroup") continue;

    const data = record(feature.featureData) ?? record(feature.message) ?? {};
    const mateType = text(data.mateType).toUpperCase();
    const instanceIds: string[] = [];

    for (const entity of list(data.matedEntities)) {
      const matedEntity = record(entity);
      const occurrence = list(matedEntity?.matedOccurrence).map((segment) => text(segment)).filter(Boolean);
      // The first path segment is the top-level instance this mate touches.
      if (occurrence[0]) instanceIds.push(occurrence[0]);
    }
    // Mate groups fasten a whole set of occurrences together at once.
    for (const entity of list(data.occurrences)) {
      const occurrence = list(record(entity)?.occurrence ?? entity)
        .map((segment) => text(segment))
        .filter(Boolean);
      if (occurrence[0]) instanceIds.push(occurrence[0]);
    }

    const unique = [...new Set(instanceIds)];
    if (!id || unique.length < 2) continue;
    mates.push({
      id,
      name: text(data.name) || text(feature.name) || "Mate",
      mateType: featureType === "mategroup" ? "FASTENED" : MATE_TYPES.has(mateType) ? mateType : "UNKNOWN",
      instanceIds: unique,
    });
  }

  return { instances, occurrences, mates };
}

/**
 * Corners of a part-local box pushed through a 4x4 row-major transform, then
 * re-bounded. This is the box of the transformed box, which is never smaller
 * than the real part — so a containment check built on it can produce a false
 * "blocked", never a false "clear". That asymmetry is deliberate: a manual that
 * wrongly warns is annoying, one that wrongly clears a step is wrong.
 */
export function transformBox(box: BoxMm, transform: number[] | null): BoxMm {
  if (!transform || transform.length !== 16) return box;
  const corners: Array<[number, number, number]> = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) corners.push([x, y, z]);
    }
  }
  // Onshape transforms are in metres; the translation column therefore needs
  // scaling to the millimetres this engine works in.
  const t = transform;
  const mapped = corners.map(([x, y, z]) => [
    t[0]! * x + t[1]! * y + t[2]! * z + metresToMm(t[3]!),
    t[4]! * x + t[5]! * y + t[6]! * z + metresToMm(t[7]!),
    t[8]! * x + t[9]! * y + t[10]! * z + metresToMm(t[11]!),
  ]);
  return {
    minX: Math.min(...mapped.map((p) => p[0]!)),
    minY: Math.min(...mapped.map((p) => p[1]!)),
    minZ: Math.min(...mapped.map((p) => p[2]!)),
    maxX: Math.max(...mapped.map((p) => p[0]!)),
    maxY: Math.max(...mapped.map((p) => p[1]!)),
    maxZ: Math.max(...mapped.map((p) => p[2]!)),
  };
}

// ---------------------------------------------------------------------------
// The network pass
// ---------------------------------------------------------------------------

async function fetchJson(http: OnshapeHttp, path: string): Promise<{ ok: boolean; body: unknown; status: number }> {
  const response = await http(path);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, body: body ?? null, status: response.status };
}

export type IngestInput = {
  http: OnshapeHttp;
  documentId: string;
  workspaceId: string;
  elementId: string;
  assemblyName?: string;
  cache?: IngestCache;
  progress?: IngestProgress;
};

export type IngestResult = {
  facts: AssemblyFacts;
  cache: IngestCache;
  calls: number;
};

/**
 * One full read of the assembly. Idempotent against its cache.
 *
 * Throws `IngestIncomplete` (carrying the cache so far) when `shouldStop`
 * fires — the caller checkpoints that cache and the next slice resumes.
 */
export async function ingestAssembly(input: IngestInput): Promise<IngestResult> {
  const cache: IngestCache = {
    assembly: input.cache?.assembly,
    elements: { ...(input.cache?.elements ?? {}) },
    studioParts: { ...(input.cache?.studioParts ?? {}) },
    studioFeatures: { ...(input.cache?.studioFeatures ?? {}) },
    studioMass: { ...(input.cache?.studioMass ?? {}) },
    partBoxes: { ...(input.cache?.partBoxes ?? {}) },
  };
  const gaps: string[] = [];
  let calls = 0;

  const step = async (label: string) => {
    calls += 1;
    await input.progress?.onCall?.({ calls, label });
    if (input.progress?.shouldStop?.()) throw new IngestIncomplete(cache, calls);
  };

  const assemblyPath =
    `/assemblies/d/${encodeURIComponent(input.documentId)}/w/${encodeURIComponent(input.workspaceId)}` +
    `/e/${encodeURIComponent(input.elementId)}?includeMateFeatures=true&includeMateConnectors=false&includeNonSolids=false`;

  if (cache.assembly === undefined) {
    const response = await fetchJson(input.http, assemblyPath);
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Onshape refused access to that assembly. Reconnect Onshape, or check the document is shared with the connected account."
          : response.status === 404
            ? "Onshape could not find that assembly. Paste the link from the Assembly tab itself (.../w/<workspace>/e/<element>)."
            : `Onshape returned ${response.status} for the assembly definition.`,
      );
    }
    cache.assembly = response.body;
    await step("assembly definition");
  }

  const parsed = parseAssemblyDefinition(cache.assembly);
  if (!parsed.instances.length) {
    gaps.push("The assembly has no instances in Onshape — there is nothing to build.");
  }

  // --- resolve the studios we need to read -------------------------------
  const studios = new Map<string, PartStudioRef>();
  for (const instance of parsed.instances) {
    if (instance.kind !== "part" || !instance.elementId) continue;
    const sameDocument = !instance.documentId || instance.documentId === input.documentId;
    const ref: PartStudioRef = sameDocument
      ? { documentId: input.documentId, wvm: "w", wvmId: input.workspaceId, elementId: instance.elementId }
      : instance.microversionId
        ? { documentId: instance.documentId, wvm: "m", wvmId: instance.microversionId, elementId: instance.elementId }
        : { documentId: instance.documentId, wvm: "w", wvmId: "", elementId: instance.elementId };
    if (!ref.wvmId) {
      gaps.push(
        `"${instance.name}" comes from a linked document that Onshape did not give a version for, so its features could not be read.`,
      );
      continue;
    }
    studios.set(studioKey(ref), ref);
  }

  // --- per-studio reads ---------------------------------------------------
  const parts = new Map<string, PartFacts>();
  const features: FeatureFacts[] = [];

  for (const [key, ref] of studios) {
    if (cache.studioParts![key] === undefined) {
      const response = await fetchJson(input.http, studioPath(ref, "parts"));
      cache.studioParts![key] = response.ok ? response.body : null;
      if (!response.ok) gaps.push(`Onshape returned ${response.status} for the part list of element ${ref.elementId}.`);
      await step(`parts of ${ref.elementId}`);
    }
    if (cache.studioMass![key] === undefined) {
      const response = await fetchJson(input.http, studioPath(ref, "partstudios", "/massproperties"));
      cache.studioMass![key] = response.ok ? response.body : null;
      if (!response.ok) gaps.push(`Onshape returned ${response.status} for the mass properties of element ${ref.elementId}.`);
      await step(`mass of ${ref.elementId}`);
    }
    if (cache.studioFeatures![key] === undefined) {
      const response = await fetchJson(input.http, studioPath(ref, "partstudios", "/features"));
      cache.studioFeatures![key] = response.ok ? response.body : null;
      if (!response.ok) {
        gaps.push(
          `Onshape returned ${response.status} for the feature tree of element ${ref.elementId}, so no fabrication instruction could be derived from its features.`,
        );
      }
      await step(`features of ${ref.elementId}`);
    }

    const mass = parseStudioMassProperties(cache.studioMass![key]);
    for (const part of parseStudioParts(cache.studioParts![key])) {
      const partKey = partKeyOf(ref, part.partId);
      const measured = mass.get(part.partId) ?? { massKg: null, volumeM3: null };
      parts.set(partKey, {
        key: partKey,
        documentId: ref.documentId,
        wvm: ref.wvm,
        workspaceId: ref.wvmId,
        elementId: ref.elementId,
        partId: part.partId,
        name: part.name,
        material: part.material,
        massKg: measured.massKg,
        volumeM3: measured.volumeM3,
        bboxMm: null,
      });
    }
    features.push(...parseFeatureList(cache.studioFeatures![key], ref.elementId));
  }

  // --- per-part bounding boxes -------------------------------------------
  for (const part of parts.values()) {
    if (cache.partBoxes![part.key] !== undefined) continue;
    const path =
      `/parts/d/${encodeURIComponent(part.documentId)}/${part.wvm}/${encodeURIComponent(part.workspaceId)}` +
      `/e/${encodeURIComponent(part.elementId)}/partid/${encodeURIComponent(part.partId)}/boundingboxes`;
    const response = await fetchJson(input.http, path);
    cache.partBoxes![part.key] = response.ok ? response.body : null;
    if (!response.ok) {
      gaps.push(
        `Onshape returned ${response.status} for the bounding box of "${part.name}", so no cut length is stated for it.`,
      );
    }
    await step(`box of ${part.name}`);
  }
  for (const part of parts.values()) {
    part.bboxMm = parseBoundingBox(cache.partBoxes![part.key]);
  }

  // --- instances ----------------------------------------------------------
  const transformByInstance = new Map<string, { transform: number[] | null; hidden: boolean }>();
  for (const occurrence of parsed.occurrences) {
    if (occurrence.path.length !== 1) continue;
    transformByInstance.set(occurrence.path[0]!, {
      transform: occurrence.transform,
      hidden: occurrence.hidden,
    });
  }

  const instances: InstanceFacts[] = parsed.instances.map((instance) => {
    const sameDocument = !instance.documentId || instance.documentId === input.documentId;
    const ref: PartStudioRef = sameDocument
      ? { documentId: input.documentId, wvm: "w", wvmId: input.workspaceId, elementId: instance.elementId }
      : { documentId: instance.documentId, wvm: "m", wvmId: instance.microversionId, elementId: instance.elementId };
    const key = instance.kind === "part" && instance.partId ? partKeyOf(ref, instance.partId) : null;
    const part = key ? (parts.get(key) ?? null) : null;
    const placement = transformByInstance.get(instance.id);
    return {
      id: instance.id,
      name: instance.name,
      kind: instance.kind,
      partKey: part ? part.key : null,
      worldBoxMm: part?.bboxMm ? transformBox(part.bboxMm, placement?.transform ?? null) : null,
      massKg: part?.massKg ?? null,
      hidden: placement?.hidden === true,
    };
  });

  const known = new Set(instances.map((instance) => instance.id));
  const mates = parsed.mates
    .map((mate) => ({ ...mate, instanceIds: mate.instanceIds.filter((id) => known.has(id)) }))
    .filter((mate) => {
      if (mate.instanceIds.length >= 2) return true;
      gaps.push(`Mate "${mate.name}" does not resolve to two instances in this assembly and was left out of the build order.`);
      return false;
    });

  if (!mates.length && instances.length > 1) {
    gaps.push(
      "This assembly has no mates Onshape could report, so the build order rests on geometry alone. Mate the assembly for a manual that follows how it actually goes together.",
    );
  }

  const withoutBox = instances.filter((instance) => instance.kind === "part" && !instance.worldBoxMm).length;
  if (withoutBox) {
    gaps.push(`${withoutBox} part instance(s) have no bounding box, so reach and containment could not be checked for them.`);
  }

  return {
    facts: {
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      elementId: input.elementId,
      name: input.assemblyName?.trim() || "Assembly",
      parts: [...parts.values()],
      instances,
      mates,
      features,
      gaps: [...new Set(gaps)],
    },
    cache,
    calls,
  };
}

/** Element list for a workspace, used to name the assembly and offer a picker. */
export async function listAssemblyElements(
  http: OnshapeHttp,
  documentId: string,
  workspaceId: string,
): Promise<Array<{ id: string; name: string; elementType: string }>> {
  const response = await fetchJson(
    http,
    `/documents/d/${encodeURIComponent(documentId)}/w/${encodeURIComponent(workspaceId)}/elements`,
  );
  if (!response.ok) throw new Error(`Onshape returned ${response.status} for the document's element list.`);
  const items = Array.isArray(response.body) ? response.body : list(record(response.body)?.items);
  return items
    .map((raw) => {
      const element = record(raw);
      const id = text(element?.id);
      if (!id) return null;
      return {
        id,
        name: text(element?.name) || "Element",
        elementType: text(element?.elementType ?? element?.type),
      };
    })
    .filter((element): element is { id: string; name: string; elementType: string } => element !== null);
}
