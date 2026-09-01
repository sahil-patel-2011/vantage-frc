/**
 * Client fetch wrapper for POST /api/cad action `list-onshape-elements`.
 *
 * Returns only Part Studio / Assembly / Variable Studio tabs Onshape already
 * listed. Empty payloads stay empty — this never invents DEMO element ids.
 */

export type ListElementsDocumentRef = {
  documentId?: string;
  workspaceId?: string;
};

export type ListDocumentElementsInput = {
  orgId: string;
  documentId?: string;
  workspaceId?: string;
  documentRef?: ListElementsDocumentRef | null;
};

export type ListedDocumentElement = {
  id: string;
  name: string;
  type: string;
  elementType: string;
};

export type ListedDocumentElements = {
  elements: ListedDocumentElement[];
};

export const EMPTY_LISTED_ELEMENTS: ListedDocumentElements = {
  elements: [],
};

const DEMO_TOKEN = /demo/i;

export function rejectDemoElementId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("Refusing DEMO element id. Use an id Onshape returned from list-onshape-elements.");
  }
  return trimmed;
}

/** Part Studio / Assembly / Variable Studio only — Feature Studio and other tabs stay out. */
export function isBindableDocumentTab(type: string, elementType = ""): boolean {
  const tokens = [type, elementType].map((value) => String(value ?? "").replace(/[\s_-]+/g, "").toLowerCase());
  return tokens.some((token) => token === "partstudio" || token === "assembly" || token === "variablestudio");
}

export function completeElementsDocumentRef(
  ref: ListElementsDocumentRef | null | undefined,
): { documentId: string; workspaceId: string } | null {
  const documentId = rejectDemoElementId(String(ref?.documentId ?? "").trim());
  const workspaceId = rejectDemoElementId(String(ref?.workspaceId ?? "").trim());
  if (!documentId || !workspaceId) return null;
  return { documentId, workspaceId };
}

export async function listDocumentElements(input: ListDocumentElementsInput): Promise<ListedDocumentElements> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");
  if (DEMO_TOKEN.test(orgId)) {
    throw new Error("Refusing DEMO org id. Use the workspace org Onshape is bound to.");
  }

  const documentRef = completeElementsDocumentRef({
    documentId: input.documentId ?? input.documentRef?.documentId,
    workspaceId: input.workspaceId ?? input.documentRef?.workspaceId,
  });
  if (!documentRef) {
    throw new Error("Bind an Onshape document/workspace first");
  }

  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list-onshape-elements",
      orgId,
      documentId: documentRef.documentId,
      workspaceId: documentRef.workspaceId,
    }),
  });

  return parseListedDocumentElements(await readCadResponse(response));
}

/**
 * Accept `{ elements: [{ id, name, type, elementType }] }` from POST /api/cad.
 * Missing / empty arrays become empty lists. DEMO ids throw. Non-tab types are skipped.
 */
export function parseListedDocumentElements(payload: unknown): ListedDocumentElements {
  const root = asRecord(payload);
  if (!root && !Array.isArray(payload)) return { ...EMPTY_LISTED_ELEMENTS, elements: [] };
  const source = Array.isArray(root?.elements) ? root!.elements : Array.isArray(payload) ? payload : [];
  return { elements: readElements(source) };
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

function readElements(value: unknown): ListedDocumentElement[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedDocumentElement[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = rejectDemoElementId(String(record?.id ?? "").trim());
    if (!id || seen.has(id)) continue;
    const type = String(record?.type ?? record?.elementType ?? "").trim();
    const elementType = String(record?.elementType ?? record?.type ?? "").trim();
    if (!isBindableDocumentTab(type, elementType)) continue;
    seen.add(id);
    rows.push({
      id,
      name: String(record?.name ?? "").trim(),
      type,
      elementType,
    });
  }
  return rows;
}
