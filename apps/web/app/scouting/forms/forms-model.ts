import { matchSchemaForYear, pitSchemaForYear, type EntryType, type ScoutSchema } from "@vantage/scouting";
import { isManualPublished } from "@vantage/game-year";
import { draftFromDefinition, DRIVETRAIN_OPTIONS_TEXT, newDraftQuestion, type DraftQuestion } from "../../../lib/scouting/form-builder";

export type SchemasPayload = {
  userId?: string;
  eventKey: string | null;
  year: number | null;
  schemas: ScoutSchema[];
  canManageSchemas: boolean;
};

export type FormBuilderMode = "edit" | "preview" | "responses";

export function defaultQuestions(type: EntryType, year?: number | null): DraftQuestion[] {
  if (year && isManualPublished(year)) return draftFromDefinition(type === "match" ? matchSchemaForYear(year) : pitSchemaForYear(year)).questions;
  if (type === "pit") {
    return [
      newDraftQuestion({
        label: "Drivetrain",
        kind: "drivetrain",
        optionsText: DRIVETRAIN_OPTIONS_TEXT,
      }),
      newDraftQuestion({
        label: "Programming language",
        kind: "dropdown",
        optionsText: "java, c++, python, labview, other",
      }),
      newDraftQuestion({ label: "Drivetrain motors", kind: "short" }),
      newDraftQuestion({ label: "Driver seasons of experience", kind: "number" }),
      newDraftQuestion({ label: "Coach seasons of experience", kind: "number" }),
      newDraftQuestion({ label: "Notes", kind: "free", role: "notes" }),
    ];
  }
  // Default roles so an untouched starter form feeds strategy out of the box.
  return [
    newDraftQuestion({ label: "Auto score", kind: "number", role: "auto_score" }),
    newDraftQuestion({ label: "Teleop score", kind: "number", role: "teleop_score" }),
    newDraftQuestion({
      label: "Endgame",
      kind: "dropdown",
      optionsText: "none, partial, full",
      role: "endgame",
    }),
    newDraftQuestion({ label: "Notes", kind: "free", role: "notes" }),
  ];
}
