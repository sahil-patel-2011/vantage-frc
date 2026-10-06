import { matchSchemaForYear, pitSchemaForYear, validatePayload, type SchemaDefinition } from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { visibleFields, withInferredPhaseRules } from "./context-visible";
import { lastPublishedPack, packForYear } from "@vantage/game-year";
import { answersToSave } from "./entry-answers";

export type FreeScoutReport = {
  id: string;
  year: number;
  type: "match" | "pit";
  teamNumber: number;
  label: string;
  payload: Record<string, unknown>;
  observedAt: string;
  /** Pins a team-authored form; the server resolves it under the team's RLS. */
  schemaId?: string;
  definition?: SchemaDefinition;
};
export type SavedFreeScoutReport = FreeScoutReport & {
  definition: SchemaDefinition;
  scoutUserId: string;
};
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function latestScoutingYear(now = new Date()): number {
  return lastPublishedPack(now.getUTCFullYear())?.year ?? now.getUTCFullYear();
}
export function scoutingGameLabel(year: number): string {
  const archived: Record<number, string> = { 2025: "REEFSCAPE", 2024: "CRESCENDO" };
  const pack = packForYear(year);
  if (archived[year]) return `${archived[year]} · ${year}`;
  return `${pack.gameName} · ${year}${pack.status === "published" ? "" : " (manual not released)"}`;
}

/** Use the same season forms and controls as event scouting, with no media or identity fields. */
export function freeScoutDefinition(year: number, type: "match" | "pit"): SchemaDefinition {
  const schema = type === "match" ? matchSchemaForYear(year) : pitSchemaForYear(year);
  return portableScoutDefinition(schema);
}

/** Identity comes from the signed-in account; disabled media cannot block a report. */
export function portableScoutDefinition(schema: SchemaDefinition): SchemaDefinition {
  return { ...schema, fields: withInferredPhaseRules(schema.fields.filter((field) =>
    !isScoutIdentityField(field) && field.type !== "robot_image",
  )) };
}

export function parseFreeScoutReport(value: unknown, publishedDefinition?: SchemaDefinition): FreeScoutReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Report is required.");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) throw new Error("Report ID is invalid.");
  if (row.type !== "match" && row.type !== "pit") throw new Error("Choose match or pit scouting.");
  if (!Number.isInteger(row.year) || Number(row.year) < 1992 || Number(row.year) > 2100) throw new Error("Season is invalid.");
  if (!Number.isInteger(row.teamNumber) || Number(row.teamNumber) < 1 || Number(row.teamNumber) > 99999) throw new Error("Enter a team number from 1 to 99999.");
  if (typeof row.label !== "string" || !row.label.trim() || row.label.trim().length > 100) throw new Error("Name this practice or video review (up to 100 characters).");
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) throw new Error("Observation time is invalid.");
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) throw new Error("Answers are required.");
  if (JSON.stringify(row.payload).length > 64_000) throw new Error("This report is too large.");
  if (row.schemaId !== undefined && (typeof row.schemaId !== "string" || !UUID_PATTERN.test(row.schemaId))) throw new Error("Form ID is invalid.");
  const definition = publishedDefinition ? portableScoutDefinition(publishedDefinition) : freeScoutDefinition(Number(row.year), row.type);
  const fields = visibleFields(definition.fields, row.payload as Record<string, unknown>);
  const payload = answersToSave(fields, row.payload as Record<string, unknown>, { fillRequiredCounters: false });
  const errors = validatePayload({ ...definition, fields }, payload);
  if (errors.length) throw new Error(errors.join("; "));
  return { id: row.id, year: Number(row.year), type: row.type, teamNumber: Number(row.teamNumber), label: row.label.trim(), payload, observedAt: new Date(row.observedAt).toISOString(), ...(typeof row.schemaId === "string" ? { schemaId: row.schemaId, definition } : {}) };
}
