/**
 * Client fetch wrapper for POST /api/cad action `list-onshape-variables`.
 *
 * Returns only name/expression/type Onshape already stored. Empty tables stay
 * empty — this never invents DEMO variables or a Variable Studio id.
 */

export type ListVariablesDocumentRef = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
};

export type ListVariablesInput = {
  orgId: string;
  documentRef?: ListVariablesDocumentRef | null;
  jobId?: string | null;
  variableStudioElementId?: string | null;
};

export type ListedOnshapeVariable = {
  name: string;
  expression: string;
  type: string;
};

export type ListedOnshapeVariables = {
  variables: ListedOnshapeVariable[];
  variableStudioElementId: string;
};

export const EMPTY_LISTED_VARIABLES: ListedOnshapeVariables = {
  variables: [],
  variableStudioElementId: "",
};

const DEMO_TOKEN = /demo/i;

export function rejectDemoVariableName(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  if (DEMO_TOKEN.test(trimmed)) {
    throw new Error("Refusing DEMO variable name. Use a name Onshape returned from list-onshape-variables.");
  }
  return trimmed;
}

export function completeVariablesDocumentRef(
  ref: ListVariablesDocumentRef | null | undefined,
): { documentId: string; workspaceId: string; elementId: string } | null {
  const documentId = String(ref?.documentId ?? "").trim();
  const workspaceId = String(ref?.workspaceId ?? "").trim();
  const elementId = String(ref?.elementId ?? "").trim();
  if (!documentId || !workspaceId || !elementId) return null;
  return { documentId, workspaceId, elementId };
}

export async function listOnshapeVariables(input: ListVariablesInput): Promise<ListedOnshapeVariables> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");

  const documentRef = completeVariablesDocumentRef(input.documentRef);
  const jobId = String(input.jobId ?? "").trim();
  if (!documentRef && !jobId) {
    throw new Error("Bind an Onshape document/workspace/element first");
  }

  const studioId = String(input.variableStudioElementId ?? "").trim();
  if (studioId && DEMO_TOKEN.test(studioId)) {
    throw new Error("Refusing DEMO Variable Studio id. Use an element Onshape listed.");
  }

  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "list-onshape-variables",
      orgId,
      ...(jobId ? { jobId } : {}),
      ...(documentRef ? { documentRef } : {}),
      ...(studioId ? { variableStudioElementId: studioId } : {}),
    }),
  });

  return parseListedVariables(await readCadResponse(response));
}

export function parseListedVariables(payload: unknown): ListedOnshapeVariables {
  const root = asRecord(payload);
  if (!root) return { ...EMPTY_LISTED_VARIABLES, variables: [] };
  const source = Array.isArray(root.variables)
    ? root.variables
    : Array.isArray(payload)
      ? payload
      : [];
  const studioId = rejectDemoStudioId(String(root.variableStudioElementId ?? "").trim());
  return {
    variables: readVariables(source),
    variableStudioElementId: studioId,
  };
}

function rejectDemoStudioId(id: string): string {
  if (!id) return "";
  if (DEMO_TOKEN.test(id)) {
    throw new Error("Refusing DEMO Variable Studio id. Use an element Onshape listed.");
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

function readVariables(value: unknown): ListedOnshapeVariable[] {
  if (!Array.isArray(value)) return [];
  const rows: ListedOnshapeVariable[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const name = rejectDemoVariableName(String(record?.name ?? "").trim());
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({
      name,
      expression: String(record?.expression ?? record?.value ?? "").trim(),
      type: String(record?.type ?? "").trim(),
    });
  }
  return rows;
}
