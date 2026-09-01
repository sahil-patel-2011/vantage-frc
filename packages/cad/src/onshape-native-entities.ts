/**
 * Native Part Studio entity ids for the CAD composer (fillet edges, hole faces,
 * body scope). Reads GET …/bodydetails only — no FeatureScript evaluation.
 *
 * Fillet / hole / chamfer take deterministic queries. Inventing an id would be a
 * fabricated result, so this helper returns only strings Onshape actually sent.
 * An empty or missing bodies array becomes empty lists, never placeholders.
 */

export type OnshapeNativeEntitiesHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeNativeEntitiesDocument = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export const ONSHAPE_NATIVE_ENTITY_KINDS = ["body", "face", "edge"] as const;
export type OnshapeNativeEntityKind = (typeof ONSHAPE_NATIVE_ENTITY_KINDS)[number];

export type OnshapeNativeBody = {
  id: string;
  bodyType: string;
};

export type OnshapeNativeFace = {
  id: string;
  bodyId: string;
  surfaceType: string;
};

export type OnshapeNativeEdge = {
  id: string;
  bodyId: string;
  geometryType: string;
};

export type OnshapeNativeEntities = {
  bodies: OnshapeNativeBody[];
  faces: OnshapeNativeFace[];
  edges: OnshapeNativeEdge[];
};

const EMPTY_ENTITIES: OnshapeNativeEntities = { bodies: [], faces: [], edges: [] };

function requiredRef(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required to list Onshape entities.`);
  return text;
}

export function onshapeNativeEntitiesPath(document: OnshapeNativeEntitiesDocument): string {
  const documentId = encodeURIComponent(requiredRef(document.documentId, "documentId"));
  const workspaceId = encodeURIComponent(requiredRef(document.workspaceId, "workspaceId"));
  const elementId = encodeURIComponent(requiredRef(document.elementId, "elementId"));
  return `/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const id = String(candidate ?? "").trim();
    if (id) return id;
  }
  return "";
}

function readType(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const type = String(candidate ?? "").trim();
    if (type) return type;
  }
  return "";
}

/**
 * Walk a bodydetails payload and keep only ids Onshape returned.
 * Missing / blank ids are skipped — this never synthesizes tokens.
 */
export function parseOnshapeNativeEntities(payload: unknown): OnshapeNativeEntities {
  const root = asRecord(payload);
  const rawBodies = Array.isArray(payload) ? payload : Array.isArray(root?.bodies) ? root.bodies : [];
  if (!rawBodies.length) return { ...EMPTY_ENTITIES };

  const bodies: OnshapeNativeBody[] = [];
  const faces: OnshapeNativeFace[] = [];
  const edges: OnshapeNativeEdge[] = [];
  const seenBodies = new Set<string>();
  const seenFaces = new Set<string>();
  const seenEdges = new Set<string>();

  for (const rawBody of rawBodies) {
    const body = asRecord(rawBody);
    if (!body) continue;
    const bodyId = readId(body.id, body.partId, body.deterministicId);
    const bodyType = readType(body.type, body.bodyType);
    if (bodyId && !seenBodies.has(bodyId)) {
      seenBodies.add(bodyId);
      bodies.push({ id: bodyId, bodyType });
    }

    const rawFaces = Array.isArray(body.faces) ? body.faces : [];
    for (const rawFace of rawFaces) {
      const face = asRecord(rawFace);
      if (!face) continue;
      const faceId = readId(face.id, face.deterministicId, face.faceId);
      if (!faceId || seenFaces.has(faceId)) continue;
      seenFaces.add(faceId);
      const surface = asRecord(face.surface) ?? {};
      faces.push({
        id: faceId,
        bodyId,
        surfaceType: readType(surface.type, surface.surfaceType, face.surfaceType),
      });
    }

    const rawEdges = Array.isArray(body.edges) ? body.edges : [];
    for (const rawEdge of rawEdges) {
      const edge = asRecord(rawEdge);
      if (!edge) continue;
      const edgeId = readId(edge.id, edge.deterministicId, edge.edgeId);
      if (!edgeId || seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      const geometry = asRecord(edge.geometry) ?? asRecord(edge.curve) ?? {};
      edges.push({
        id: edgeId,
        bodyId,
        geometryType: readType(geometry.type, geometry.geometryType, edge.geometryType, edge.type),
      });
    }
  }

  return { bodies, faces, edges };
}

/** Ids only — what a human pastes into the composer idList fields. */
export function nativeEntityIds(entities: OnshapeNativeEntities, kind: OnshapeNativeEntityKind): string[] {
  const rows = kind === "body" ? entities.bodies : kind === "face" ? entities.faces : entities.edges;
  return rows.map((row) => row.id);
}

export async function listOnshapeNativeEntities(
  http: OnshapeNativeEntitiesHttp,
  document: OnshapeNativeEntitiesDocument,
): Promise<OnshapeNativeEntities> {
  const path = onshapeNativeEntitiesPath(document);
  const response = await http(path, { method: "GET" });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Onshape body details returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      (typeof body === "string" ? body : JSON.stringify(body ?? {}));
    throw new Error(
      `Onshape could not list Part Studio entities (HTTP ${response.status}): ${String(message).slice(0, 300)}`,
    );
  }
  return parseOnshapeNativeEntities(body);
}
