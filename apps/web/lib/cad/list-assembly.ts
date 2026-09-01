/**
 * Client fetch wrapper for POST /api/cad action `list-onshape-assembly`.
 *
 * Returns only instance ids Onshape already listed via getOnshapeAssembly.
 * Empty payloads stay empty — this never invents DEMO instance ids.
 */

export type ListAssemblyDocumentRef = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
};

export type ListAssemblyInput = {
  orgId: string;
  documentRef?: ListAssemblyDocumentRef | null;
  jobId?: string | null;
  assemblyElementId?: string | null;
};

export type ListedAssemblyInstance = {
  id: string;
  name: string;
};

export type ListedOnshapeAssembly = {
  instances: ListedAssemblyInstance[];
  assemblyElementId: string;
};

export const EMPTY_LISTED_ASSEMBLY: ListedOnshapeAssembly = {
  instances: [],
  assemblyElementId: "",
};

const DEMO_TOKEN = /demo/i;

export function rejectDemoInstanceId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("Refusing DEMO instance id. Use an id Onshape returned from list-onshape-assembly.");
  }
  return trimmed;
}

export function completeAssemblyDocumentRef(
  ref: ListAssemblyDocumentRef | null | undefined,
): { documentId: string; workspaceId: string; elementId: string } | null {
  const documentId = String(ref?.documentId ?? "").trim();
  const workspaceId = String(ref?.workspaceId ?? "").trim();
  const elementId = String(ref?.elementId ?? "").trim();
  if (!documentId || !workspaceId || !elementId) return null;
  return { documentId, workspaceId, elementId };
}

/**
 * Assembly listing requires an explicit assembly element id.
 * Never fall back to `documentRef.elementId` — that is often a Part Studio.
 */
export function resolveAssemblyElementId(assemblyElementId: string | null | undefined): string {
  return String(assemblyElementId ?? "").trim();
}

export async function listOnshapeAssemblyInstances(input: ListAssemblyInput): Promise<ListedOnshapeAssembly> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");

  const documentRef = completeAssemblyDocumentRef(input.documentRef);
  const jobId = String(input.jobId ?? "").trim();
  if (!documentRef && !jobId) {
    throw new Error("Bind an Onshape document/workspace/element first");
  }

  const assemblyElementId = resolveAssemblyElementId(input.assemblyElementId);
  if (assemblyElementId && DEMO_TOKEN.test(assemblyElementId)) {
    throw new Error("Refusing DEMO assembly element id. Use an element Onshape listed.");
  }

  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list-onshape-assembly",
      orgId,
      ...(jobId ? { jobId } : {}),
      ...(documentRef ? { documentRef } : {}),
      ...(assemblyElementId ? { assemblyElementId } : {}),
    }),
  });

  return parseListedInstances(await readCadResponse(response));
}

/**
 * Accept `{ instances }` from POST /api/cad, or a raw instances array.
 * Missing / empty arrays become empty lists. DEMO ids throw.
 */
export function parseListedInstances(payload: unknown): ListedOnshapeAssembly {
  const root = asRecord(payload);
  if (!root && !Array.isArray(payload)) return { ...EMPTY_LISTED_ASSEMBLY, instances: [] };
  const source = Array.isArray(root?.instances)
    ? root!.instances
    : Array.isArray(payload)
      ? payload
      : [];
  const assemblyElementId = rejectDemoAssemblyElementId(String(root?.assemblyElementId ?? "").trim());
  return {
    instances: readInstances(source),
    assemblyElementId,
  };
}

function rejectDemoAssemblyElementId(id: string): string {
  if (!id) return "";
  if (DEMO_TOKEN.test(id)) {
    throw new Error("Refusing DEMO assembly element id. Use an element Onshape listed.");
  }
  return id;
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

function readInstances(value: unknown): ListedAssemblyInstance[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedAssemblyInstance[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = rejectDemoInstanceId(String(record?.id ?? record?.instanceId ?? "").trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: String(record?.name ?? "").trim() });
  }
  return rows;
}
