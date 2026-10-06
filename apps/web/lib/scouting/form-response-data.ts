import type { SchemaDefinition } from "@vantage/scouting";
import type { FormResponseRow, ScoutTotal } from "./form-response-summary";

export type FormResponseData = {
  definition: SchemaDefinition;
  rows: FormResponseRow[];
  hasMore: boolean;
  scouts: ScoutTotal[] | null;
  idle: string[] | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Reject an incomplete response rather than presenting broken data as an empty form. */
export function isFormResponseData(value: unknown): value is FormResponseData {
  if (!record(value) || !record(value.definition) || typeof value.definition.title !== "string"
    || !Array.isArray(value.definition.fields) || !Array.isArray(value.rows)
    || typeof value.hasMore !== "boolean") return false;
  if (!value.definition.fields.every(field => record(field) && typeof field.key === "string"
    && typeof field.label === "string" && typeof field.type === "string"
    && (field.config === undefined || record(field.config)))) return false;
  if (!value.rows.every(row => record(row) && typeof row.id === "string" && typeof row.team === "string"
    && typeof row.label === "string" && (row.event === null || typeof row.event === "string")
    && record(row.payload) && timestamp(row.observedAt)
    && (row.scoutId === undefined || typeof row.scoutId === "string")
    && (row.scout === undefined || typeof row.scout === "string")
    && (row.mine === undefined || typeof row.mine === "boolean"))) return false;
  return (value.scouts === null || (Array.isArray(value.scouts) && value.scouts.every(scout =>
    record(scout) && typeof scout.id === "string" && typeof scout.name === "string"
    && count(scout.total) && count(scout.teams) && timestamp(scout.lastAt))))
    && (value.idle === null || (Array.isArray(value.idle) && value.idle.every(name => typeof name === "string")));
}

export class FormResponsesError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  get discardPrevious() { return [401, 403, 404].includes(this.status); }
}

export async function loadFormResponses(orgId: string, schemaId: string, signal: AbortSignal): Promise<FormResponseData> {
  const query = new URLSearchParams({ orgId, schemaId });
  const response = await fetch(`/api/scouting/form-responses?${query}`, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = record(body) && typeof body.error === "string" ? body.error : "Could not load responses.";
    throw new FormResponsesError(message, response.status);
  }
  if (!isFormResponseData(body)) throw new FormResponsesError("The response data is incomplete. Try loading it again.", response.status);
  return body;
}
