/**
 * Client fetch wrapper for POST /api/cad action `list-onshape-documents`.
 *
 * Returns only documents Onshape already listed for the connected account.
 * Empty payloads stay empty — this never invents DEMO document ids.
 */

export type ListedOnshapeDocument = {
  id: string;
  name: string;
  defaultWorkspaceId: string;
};

export type ListedOnshapeDocuments = {
  documents: ListedOnshapeDocument[];
};

export const EMPTY_LISTED_DOCUMENTS: ListedOnshapeDocuments = {
  documents: [],
};

const DEMO_TOKEN = /demo/i;

export function rejectDemoDocumentId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("Refusing DEMO document id. Use an id Onshape returned from list-onshape-documents.");
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readDocuments(value: unknown): ListedOnshapeDocument[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedOnshapeDocument[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = rejectDemoDocumentId(String(record?.id ?? "").trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: String(record?.name ?? "").trim() || "Untitled",
      defaultWorkspaceId: rejectDemoDocumentId(String(record?.defaultWorkspaceId ?? "").trim()),
    });
  }
  return rows;
}

/**
 * Accept `{ documents: [{ id, name, defaultWorkspaceId }] }` from POST /api/cad.
 * Missing / empty arrays become empty lists. DEMO ids throw.
 */
export function parseListedOnshapeDocuments(payload: unknown): ListedOnshapeDocuments {
  const root = asRecord(payload);
  if (!root && !Array.isArray(payload)) return { ...EMPTY_LISTED_DOCUMENTS, documents: [] };
  const source = Array.isArray(root?.documents) ? root!.documents : Array.isArray(payload) ? payload : [];
  return { documents: readDocuments(source) };
}

async function readCadResponse(response: Response): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.message === "string" && data.message.trim()) ||
      "Could not list Onshape documents.";
    throw new Error(message);
  }
  return data;
}

export async function listOnshapeDocuments(input: { orgId: string }): Promise<ListedOnshapeDocuments> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");
  if (DEMO_TOKEN.test(orgId)) {
    throw new Error("Refusing DEMO org id. Choose your team first.");
  }

  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list-onshape-documents",
      orgId,
    }),
  });

  return parseListedOnshapeDocuments(await readCadResponse(response));
}
