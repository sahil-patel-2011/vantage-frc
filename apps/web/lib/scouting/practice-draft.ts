import type { SchemaDefinition } from "@vantage/scouting";
import { UUID_PATTERN } from "./free-scout";
import { scoutSchemaDefinitionShape } from "./schema-publication";

export type PracticeDraft = {
  clientId: string;
  type: "match" | "pit";
  team: string;
  label: string;
  year: number;
  schemaId?: string;
  definition?: SchemaDefinition;
  payload: Record<string, unknown>;
};

/** Restored drafts are untrusted device data, never a reason to crash the form. */
export function parsePracticeDraft(value: unknown, legacyClientId: string): PracticeDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Draft recovery is unavailable.");
  const row = value as PracticeDraft;
  if ((row.type !== "match" && row.type !== "pit") || typeof row.team !== "string" || typeof row.label !== "string"
    || !Number.isInteger(row.year) || row.year < 1992 || row.year > 2100
    || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) throw new Error("Draft details are unreadable.");
  const clientId = row.clientId ?? legacyClientId;
  if (typeof clientId !== "string" || !UUID_PATTERN.test(clientId)) throw new Error("Draft report ID is unreadable.");
  if (row.schemaId !== undefined && (typeof row.schemaId !== "string" || !UUID_PATTERN.test(row.schemaId))) throw new Error("Draft form ID is unreadable.");
  if ((row.schemaId && !row.definition) || (row.definition && !scoutSchemaDefinitionShape.safeParse(row.definition).success)) {
    throw new Error("The draft's original questions are unreadable. The stored draft has been kept.");
  }
  return { ...row, clientId };
}

/** A new robot, match or set of questions needs its own report and fresh answers. */
export function samePracticeTarget(a: PracticeDraft, b: PracticeDraft): boolean {
  return a.type === b.type && a.team === b.team && a.year === b.year && a.schemaId === b.schemaId
    && JSON.stringify(a.definition ?? null) === JSON.stringify(b.definition ?? null)
    && (a.type === "pit" || a.label.trim() === b.label.trim());
}
