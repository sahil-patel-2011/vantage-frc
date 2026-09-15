import { type EntryType, type ScoutSchema, matchSchemaForYear, pitSchemaForYear } from "@vantage/scouting";
import { currentSeasonYear } from "@vantage/game-year";
import { draftFromDefinition, newDraftQuestion, type DraftQuestion } from "../../../lib/scouting/form-builder";

export type SchemasPayload = {
  eventKey: string | null;
  year: number | null;
  schemas: ScoutSchema[];
  canManageSchemas: boolean;
};

export type FormBuilderMode = "edit" | "preview";

/** Starter draft from the season pack so unpublished forms still scout the intended thing. */
export function defaultQuestions(type: EntryType, year?: number | null): DraftQuestion[] {
  const packYear = year ?? currentSeasonYear();
  const schema = type === "pit" ? pitSchemaForYear(packYear) : matchSchemaForYear(packYear);
  const draft = draftFromDefinition(schema);
  if (draft.questions.length) return draft.questions;
  return [newDraftQuestion({ label: "Notes", kind: "free", role: "notes" })];
}
