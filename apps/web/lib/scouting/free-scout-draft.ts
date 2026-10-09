import { type SchemaDefinition } from "@vantage/scouting";
import { latestScoutingYear, UUID_PATTERN } from "./free-scout";
import { scoutSchemaDefinitionShape } from "./schema-publication";

export type FreeScoutDraft = {
  type: "match" | "pit";
  team: string;
  label: string;
  year: number;
  schemaId?: string;
  definition?: SchemaDefinition;
  payload: Record<string, unknown>;
  reportId?: string;
  observedAt?: string;
};

export function freshFreeScoutDraft(type: FreeScoutDraft["type"] = "pit"): FreeScoutDraft {
  return { type, team: "", label: "Practice 1", year: latestScoutingYear(), payload: {} };
}

/** Old device drafts remain readable; malformed form snapshots cannot reach the renderer. */
export function parseFreeScoutDraft(raw: string): FreeScoutDraft {
  if (raw.length > 262_144) throw new Error("Draft is too large.");
  const value = JSON.parse(raw) as FreeScoutDraft;
  if (!value || !["match", "pit"].includes(value.type) || typeof value.team !== "string" || !/^\d{0,5}$/.test(value.team) ||
    typeof value.label !== "string" || value.label.length > 100 || !Number.isInteger(value.year) ||
    value.year < 1992 || value.year > 2100 || !value.payload || typeof value.payload !== "object" || Array.isArray(value.payload) ||
    (value.schemaId !== undefined && (typeof value.schemaId !== "string" || !UUID_PATTERN.test(value.schemaId))) ||
    (value.reportId !== undefined && (typeof value.reportId !== "string" || !UUID_PATTERN.test(value.reportId))) ||
    (value.observedAt !== undefined && (typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))))) throw new Error("Invalid draft.");
  if (value.definition !== undefined) {
    const definition = scoutSchemaDefinitionShape.safeParse(value.definition);
    if (!definition.success) throw new Error("Invalid saved form.");
    value.definition = definition.data;
  }
  return value;
}
