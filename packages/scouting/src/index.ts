export type Confidence = "high" | "normal" | "low";
export type EntrySource = "manual" | "voice" | "import";
export type EntryType = "match" | "pit";
export type FieldType = "number" | "boolean" | "text" | "select";

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  disagreementThreshold?: number;
};

export type SchemaDefinition = { title: string; fields: FieldDefinition[] };

export type ScoutSchema = {
  id: string;
  orgId: string;
  year: number;
  type: EntryType;
  version: number;
  definition: SchemaDefinition;
};

export type SyncEntry = {
  clientId: string;
  type: EntryType;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  schemaId: string;
  payload: Record<string, unknown>;
  confidence: Confidence;
  source: EntrySource;
  updatedAt: string;
};

export type FormulaExpression =
  | { op: "field"; field: string }
  | { op: "constant"; value: number }
  | {
      op: "add" | "subtract" | "multiply" | "divide" | "min" | "max";
      args: FormulaExpression[];
    };

export function validatePayload(
  schema: SchemaDefinition,
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const allowed = new Set(schema.fields.map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) errors.push(`Unknown field: ${key}`);
  }
  for (const field of schema.fields) {
    const value = payload[field.key];
    if (field.required && (value === undefined || value === null || value === "")) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`${field.label} must be a number`);
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${field.label} must be true or false`);
    } else if ((field.type === "text" || field.type === "select") && typeof value !== "string") {
      errors.push(`${field.label} must be text`);
    } else if (field.type === "select" && !field.options?.includes(String(value))) {
      errors.push(`${field.label} has an invalid option`);
    }
  }
  return errors;
}

export function evaluateFormula(
  expression: FormulaExpression,
  payload: Record<string, unknown>,
): number {
  if (expression.op === "constant") return expression.value;
  if (expression.op === "field") {
    const value = payload[expression.field];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  const values = expression.args.map((arg) => evaluateFormula(arg, payload));
  if (values.length === 0) return 0;
  switch (expression.op) {
    case "add":
      return values.reduce((sum, value) => sum + value, 0);
    case "subtract":
      return values.slice(1).reduce((result, value) => result - value, values[0] ?? 0);
    case "multiply":
      return values.reduce((result, value) => result * value, 1);
    case "divide":
      return values.slice(1).reduce(
        (result, value) => (value === 0 ? result : result / value),
        values[0] ?? 0,
      );
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

export type Disagreement = {
  fieldKey: string;
  entryIds: string[];
  values: unknown[];
};

export function detectDisagreements(
  schema: SchemaDefinition,
  entries: Array<{ id: string; payload: Record<string, unknown>; confidence: Confidence }>,
): Disagreement[] {
  const eligible = entries.filter((entry) => entry.confidence !== "low");
  if (eligible.length < 2) return [];
  const disagreements: Disagreement[] = [];
  for (const field of schema.fields) {
    const observed = eligible
      .map((entry) => ({ id: entry.id, value: entry.payload[field.key] }))
      .filter(({ value }) => value !== undefined && value !== null);
    if (observed.length < 2) continue;
    const values = observed.map(({ value }) => value);
    const diverges =
      field.type === "number"
        ? Math.max(...values.map(Number)) - Math.min(...values.map(Number)) >
          (field.disagreementThreshold ?? 0)
        : new Set(values.map((value) => JSON.stringify(value))).size > 1;
    if (diverges) {
      disagreements.push({
        fieldKey: field.key,
        entryIds: observed.map(({ id }) => id),
        values,
      });
    }
  }
  return disagreements;
}

export interface MediaStorage {
  createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }): Promise<{ storageKey: string; uploadUrl: string }>;
}

export class LocalMediaStorage implements MediaStorage {
  async createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }) {
    return {
      storageKey: `local/${input.orgId}/${input.clientId}`,
      uploadUrl: `/api/scouting/media/${encodeURIComponent(input.clientId)}?orgId=${encodeURIComponent(input.orgId)}`,
    };
  }
}

export interface VoiceDraftAdapter {
  transcript(blob: Blob): Promise<string>;
}

export class BrowserVoiceDraftAdapter implements VoiceDraftAdapter {
  async transcript(): Promise<string> {
    throw new Error("Browser speech recognition must provide the transcript");
  }
}
