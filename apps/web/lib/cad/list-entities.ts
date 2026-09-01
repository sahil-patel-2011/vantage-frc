/**
 * Client fetch wrapper for POST /api/cad action `list-onshape-entities`.
 *
 * Returns only body/face/edge ids the hosted API actually sent. Empty payloads
 * stay empty — this never invents tokens. DEMO / placeholder ids are refused.
 */

export type ListEntitiesDocumentRef = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
};

export type ListEntitiesInput = {
  orgId: string;
  documentRef?: ListEntitiesDocumentRef | null;
  jobId?: string | null;
};

export type ListedEntityBody = {
  id: string;
  bodyType: string;
};

export type ListedEntityFace = {
  id: string;
  bodyId: string;
  surfaceType: string;
};

export type ListedEntityEdge = {
  id: string;
  bodyId: string;
  geometryType: string;
};

export type ListedOnshapeEntities = {
  bodies: ListedEntityBody[];
  faces: ListedEntityFace[];
  edges: ListedEntityEdge[];
};

export const EMPTY_LISTED_ENTITIES: ListedOnshapeEntities = {
  bodies: [],
  faces: [],
  edges: [],
};

const DEMO_ENTITY_ID = /demo/i;

export function rejectDemoEntityId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  if (DEMO_ENTITY_ID.test(trimmed)) {
    throw new Error("Refusing DEMO entity id. Use an id Onshape returned from list-onshape-entities.");
  }
  return trimmed;
}

export function completeDocumentRef(
  ref: ListEntitiesDocumentRef | null | undefined,
): { documentId: string; workspaceId: string; elementId: string } | null {
  const documentId = String(ref?.documentId ?? "").trim();
  const workspaceId = String(ref?.workspaceId ?? "").trim();
  const elementId = String(ref?.elementId ?? "").trim();
  if (!documentId || !workspaceId || !elementId) return null;
  return { documentId, workspaceId, elementId };
}

export async function listOnshapeEntities(input: ListEntitiesInput): Promise<ListedOnshapeEntities> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");

  const documentRef = completeDocumentRef(input.documentRef);
  const jobId = String(input.jobId ?? "").trim();
  if (!documentRef && !jobId) {
    throw new Error("Bind an Onshape document/workspace/element first");
  }

  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list-onshape-entities",
      orgId,
      ...(jobId ? { jobId } : {}),
      ...(documentRef ? { documentRef } : {}),
    }),
  });

  return parseListedEntities(await readCadResponse(response));
}

/**
 * Accept `{ entities }` from POST /api/cad, or the entities object itself.
 * Missing / empty arrays become empty lists. DEMO ids throw.
 */
export function parseListedEntities(payload: unknown): ListedOnshapeEntities {
  const root = asRecord(payload);
  if (!root) return { ...EMPTY_LISTED_ENTITIES };
  const source = asRecord(root.entities) ?? (looksLikeEntities(root) ? root : null);
  if (!source) return { ...EMPTY_LISTED_ENTITIES };
  return {
    bodies: readBodies(source.bodies),
    faces: readFaces(source.faces),
    edges: readEdges(source.edges),
  };
}

/** Ids a human can pick for an idList field. `views` is not geometry — stays empty. */
export function pickableEntityIds(
  fieldKey: string,
  entities: ListedOnshapeEntities | null | undefined,
): string[] {
  const safe = entities ?? EMPTY_LISTED_ENTITIES;
  const key = String(fieldKey ?? "").trim();
  if (!key || /^views$/i.test(key)) return [];
  if (/face/i.test(key)) return idsOf(safe.faces);
  if (/body/i.test(key)) return idsOf(safe.bodies);
  if (/edge/i.test(key) || key === "entities") return idsOf(safe.edges);
  return [];
}

export function splitIdList(value: string): string[] {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toggleIdListValue(current: string, id: string): string {
  const real = rejectDemoEntityId(id);
  if (!real) return current;
  const ids = splitIdList(current);
  const next = ids.includes(real) ? ids.filter((item) => item !== real) : [...ids, real];
  return next.join(", ");
}

async function readCadResponse(response: Response): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.message === "string" && data.message.trim()) ||
      "CAD request failed";
    throw new Error(message);
  }
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function looksLikeEntities(value: Record<string, unknown>): boolean {
  return "bodies" in value || "faces" in value || "edges" in value;
}

function readId(value: unknown): string {
  return rejectDemoEntityId(typeof value === "string" ? value : "");
}

function readBodies(value: unknown): ListedEntityBody[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedEntityBody[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = readId(record?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, bodyType: String(record?.bodyType ?? "").trim() });
  }
  return rows;
}

function readFaces(value: unknown): ListedEntityFace[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedEntityFace[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = readId(record?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      bodyId: String(record?.bodyId ?? "").trim(),
      surfaceType: String(record?.surfaceType ?? "").trim(),
    });
  }
  return rows;
}

function readEdges(value: unknown): ListedEntityEdge[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedEntityEdge[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = readId(record?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      bodyId: String(record?.bodyId ?? "").trim(),
      geometryType: String(record?.geometryType ?? "").trim(),
    });
  }
  return rows;
}

function idsOf(rows: ReadonlyArray<{ id: string }>): string[] {
  return rows.map((row) => row.id).filter(Boolean);
}
