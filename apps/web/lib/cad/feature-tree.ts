/**
 * Hosted CAD feature-tree helpers.
 *
 * parseExplainFeatures reads POST /api/cad `explain-onshape-features` JSON and
 * keeps only rows that already carry a real featureId. IDs are never invented.
 * updateFeaturePayload builds the POST /api/cad `update-onshape-feature` body
 * and refuses DEMO or blank ids before anything is sent.
 */

export type ExplainedFeature = {
  featureId: string;
  name: string;
  type: string;
};

export type UpdateFeatureInput = {
  featureId: unknown;
  depthMm?: unknown;
  widthMm?: unknown;
  heightMm?: unknown;
};

export type UpdateFeaturePayload = {
  action: "update-onshape-feature";
  featureId: string;
  depthMm?: number;
  widthMm?: number;
  heightMm?: number;
};

const DEMO_FEATURE_ID = /demo/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonInput(json: unknown): unknown {
  if (typeof json === "string") {
    const trimmed = json.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  return json;
}

/** Only the `features` array Onshape/API returned — never explain.steps (no ids). */
function featureRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  return Array.isArray(record.features) ? record.features : [];
}

function readFeatureId(row: Record<string, unknown>): string {
  const message = asRecord(row.message);
  const candidates = [row.featureId, row.id];
  if (message) candidates.push(message.featureId, message.id);
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim();
    if (id) return id;
  }
  return "";
}

function readName(row: Record<string, unknown>): string {
  const message = asRecord(row.message);
  const name = message?.name ?? row.name;
  return typeof name === "string" ? name.trim() : "";
}

function readType(row: Record<string, unknown>): string {
  const message = asRecord(row.message);
  const type = message?.featureType ?? row.featureType ?? row.type;
  return typeof type === "string" ? type.trim() : "";
}

/**
 * Extract `{ featureId, name, type }` from explain-onshape-features JSON.
 * Rows without a real id are dropped. Names/types stay empty when missing.
 */
export function parseExplainFeatures(json: unknown): ExplainedFeature[] {
  const root = parseJsonInput(json);
  const out: ExplainedFeature[] = [];
  for (const entry of featureRows(root)) {
    const row = asRecord(entry);
    if (!row) continue;
    const featureId = readFeatureId(row);
    if (!featureId) continue;
    out.push({
      featureId,
      name: readName(row),
      type: readType(row),
    });
  }
  return out;
}

function requireCreatedFeatureId(featureId: unknown): string {
  const id = typeof featureId === "string" ? featureId.trim() : "";
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
  const mm = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(mm) || mm <= 0 || mm > 10_000) {
    throw new Error(`${label} must be a positive number of millimetres (max 10000).`);
  }
  return mm;
}

/** Body for POST /api/cad action update-onshape-feature. No invented ids. */
export function updateFeaturePayload(input: UpdateFeatureInput): UpdateFeaturePayload {
  const featureId = requireCreatedFeatureId(input.featureId);
  const depthMm = optionalPositiveMm(input.depthMm, "depthMm");
  const widthMm = optionalPositiveMm(input.widthMm, "widthMm");
  const heightMm = optionalPositiveMm(input.heightMm, "heightMm");
  return {
    action: "update-onshape-feature",
    featureId,
    ...(depthMm !== undefined ? { depthMm } : {}),
    ...(widthMm !== undefined ? { widthMm } : {}),
    ...(heightMm !== undefined ? { heightMm } : {}),
  };
}
