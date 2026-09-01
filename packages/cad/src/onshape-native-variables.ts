/**
 * Native Onshape set_variable — GET/POST the Variables REST, never FeatureScript.
 *
 * Official paths (Glassworks Variables API):
 *   GET  /variables/d/{did}/{wv}/{wvid}/e/{eid}/variables
 *   POST /variables/d/{did}/w/{wid}/e/{eid}/variables
 *
 * POST assigns variables on a Variable Studio. GET reads variable tables on a
 * Variable Studio or a Part Studio. This module never evaluates FeatureScript
 * and never invents a name Onshape did not echo back.
 */

export type OnshapeNativeVariablesHttp = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeNativeVariablesDocument = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export const ONSHAPE_VARIABLE_TYPES = ["LENGTH", "ANGLE", "NUMBER", "ANY"] as const;
export type OnshapeVariableType = (typeof ONSHAPE_VARIABLE_TYPES)[number];

export type OnshapeNativeVariable = {
  name: string;
  expression: string;
  type: OnshapeVariableType;
};

export type OnshapeNativeVariableResult = {
  featureId: string;
  name: string;
  expression: string;
  type: OnshapeVariableType;
  featureScriptUsed: false;
};

const DEMO_TOKEN = /demo/i;
const VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function requiredRef(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required to read or write Onshape variables.`);
  return text;
}

export function onshapeVariablesPath(document: OnshapeNativeVariablesDocument): string {
  const documentId = encodeURIComponent(requiredRef(document.documentId, "documentId"));
  const workspaceId = encodeURIComponent(requiredRef(document.workspaceId, "workspaceId"));
  const elementId = encodeURIComponent(requiredRef(document.elementId, "elementId"));
  return `/variables/d/${documentId}/w/${workspaceId}/e/${elementId}/variables`;
}

export function requireOnshapeVariableName(name: unknown): string {
  const value = String(name ?? "").trim();
  if (!value) {
    throw new Error("set_variable requires a variable name; no variable was written.");
  }
  if (DEMO_TOKEN.test(value)) {
    throw new Error("Refusing DEMO variable name. Pass a real Onshape variable name.");
  }
  if (!VARIABLE_NAME.test(value)) {
    throw new Error(
      `Variable name must be an Onshape identifier (letter or underscore, then letters/digits/underscores). Got "${value}".`,
    );
  }
  return value;
}

export function requireOnshapeVariableExpression(value: unknown): string {
  if (value === undefined || value === null) {
    throw new Error("set_variable requires a value/expression; no variable was written.");
  }
  const expression = String(value).trim();
  if (!expression) {
    throw new Error("set_variable requires a value/expression; no variable was written.");
  }
  if (DEMO_TOKEN.test(expression)) {
    throw new Error("Refusing DEMO variable value. Pass a real Onshape expression such as \"2 mm\".");
  }
  return expression;
}

export function inferOnshapeVariableType(expression: string, explicit?: unknown): OnshapeVariableType {
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    const raw = String(explicit).trim().toUpperCase();
    if ((ONSHAPE_VARIABLE_TYPES as readonly string[]).includes(raw)) {
      return raw as OnshapeVariableType;
    }
    throw new Error(`Variable type must be one of ${ONSHAPE_VARIABLE_TYPES.join(", ")}. Got "${String(explicit)}".`);
  }
  const trimmed = expression.trim();
  if (/\b(?:deg|degree|rad|radian)s?\b/i.test(trimmed)) return "ANGLE";
  if (/\b(?:mm|cm|m|in|inch|inches|ft|foot|feet)\b/i.test(trimmed)) return "LENGTH";
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return "NUMBER";
  return "ANY";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readType(raw: unknown): OnshapeVariableType | "" {
  const type = String(raw ?? "").trim().toUpperCase();
  return (ONSHAPE_VARIABLE_TYPES as readonly string[]).includes(type) ? (type as OnshapeVariableType) : "";
}

/**
 * Walk GET …/variables tables and keep only name/expression/type Onshape sent.
 * Blank names are skipped — this never synthesizes DEMO or placeholder tokens.
 */
export function parseOnshapeVariables(payload: unknown): OnshapeNativeVariable[] {
  const tables = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.variables)
      ? [payload]
      : [];
  const found: OnshapeNativeVariable[] = [];
  const seen = new Set<string>();

  for (const rawTable of tables) {
    const table = asRecord(rawTable);
    const rows = Array.isArray(rawTable)
      ? rawTable
      : Array.isArray(table?.variables)
        ? table.variables
        : [];
    for (const raw of rows) {
      const row = asRecord(raw);
      if (!row) continue;
      const name = String(row.name ?? "").trim();
      if (!name || seen.has(name) || DEMO_TOKEN.test(name)) continue;
      seen.add(name);
      const expression = String(row.expression ?? row.value ?? "").trim();
      found.push({
        name,
        expression,
        type: readType(row.type) || inferOnshapeVariableType(expression),
      });
    }
  }
  return found;
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

function optionalString(parameters: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const raw = parameters[name];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return "";
}

function targetDocument(
  document: OnshapeNativeVariablesDocument,
  parameters: Record<string, unknown>,
): OnshapeNativeVariablesDocument {
  const elementId =
    optionalString(parameters, ["variableStudioElementId", "variableStudioId", "elementId"]) ||
    document.elementId;
  return {
    documentId: requiredRef(document.documentId, "documentId"),
    workspaceId: requiredRef(document.workspaceId, "workspaceId"),
    elementId: requiredRef(elementId, "elementId"),
  };
}

export function isOnshapeVariableStudio(elementType: unknown): boolean {
  return /variable/i.test(String(elementType ?? "").replace(/\s+/g, ""));
}

/**
 * Pick a Variable Studio tab Onshape already listed. Empty stays empty —
 * never invents a studio id, never prefers a Part Studio.
 */
export function pickVariableStudioElementId(
  elements: ReadonlyArray<{ id?: unknown; elementType?: unknown }>,
  preferredId?: unknown,
): string {
  const studios = elements
    .filter((element) => isOnshapeVariableStudio(element.elementType))
    .map((element) => String(element.id ?? "").trim())
    .filter((id) => id && !DEMO_TOKEN.test(id));
  const preferred = String(preferredId ?? "").trim();
  if (preferred && DEMO_TOKEN.test(preferred)) {
    throw new Error("Refusing DEMO Variable Studio id. Use an element Onshape listed.");
  }
  if (preferred && studios.includes(preferred)) return preferred;
  return studios[0] ?? "";
}

async function getOnshapeVariables(
  http: OnshapeNativeVariablesHttp,
  path: string,
): Promise<OnshapeNativeVariable[]> {
  const response = await http(path, { method: "GET" });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(
      `Onshape variables GET failed (HTTP ${response.status}): ${detailOf(body, response).slice(0, 400)}`,
    );
  }
  return parseOnshapeVariables(body);
}

/** GET …/variables. Never FeatureScript. Empty tables stay empty. */
export async function listOnshapeNativeVariables(
  http: OnshapeNativeVariablesHttp,
  document: OnshapeNativeVariablesDocument,
): Promise<OnshapeNativeVariable[]> {
  return getOnshapeVariables(http, onshapeVariablesPath(document));
}

/**
 * GET existing variable tables, POST BTVariableParams to assign, GET again so
 * the returned name is the one Onshape stored. Never FeatureScript, never DEMO.
 */
export async function setOnshapeNativeVariable(
  http: OnshapeNativeVariablesHttp,
  input: {
    document: OnshapeNativeVariablesDocument;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<OnshapeNativeVariableResult> {
  const name = requireOnshapeVariableName(
    optionalString(input.parameters, ["name", "variableName"]) || input.parameters.name,
  );
  const expression = requireOnshapeVariableExpression(
    input.parameters.value ?? input.parameters.expression ?? input.parameters.variableValue,
  );
  const document = targetDocument(input.document, input.parameters);
  const path = onshapeVariablesPath(document);

  const existing = await getOnshapeVariables(http, path);
  const prior = existing.find((row) => row.name === name);
  const type = inferOnshapeVariableType(expression, input.parameters.type ?? input.parameters.variableType ?? prior?.type);

  const payload = [
    {
      name,
      type,
      expression,
      ...(optionalString(input.parameters, ["description"])
        ? { description: optionalString(input.parameters, ["description"]) }
        : {}),
    },
  ];

  const postResponse = await http(path, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "x-vantage-idempotency": input.idempotencyKey },
  });
  const postBody = await readBody(postResponse);
  if (!postResponse.ok) {
    throw new Error(
      `Onshape variables POST failed (HTTP ${postResponse.status}): ${detailOf(postBody, postResponse).slice(0, 400)}`,
    );
  }

  const confirmed = await getOnshapeVariables(http, path);
  const stored = confirmed.find((row) => row.name === name);
  if (!stored) {
    throw new Error(
      `Onshape did not return variable "${name}" after POST. No variable name was invented.`,
    );
  }

  return {
    featureId: stored.name,
    name: stored.name,
    expression: stored.expression || expression,
    type: stored.type || type,
    featureScriptUsed: false,
  };
}
