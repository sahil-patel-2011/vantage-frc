import { matchSchemaForYear, pitSchemaForYear, type EntryType, type ScoutSchema } from "@vantage/scouting";
import { isManualPublished } from "@vantage/game-year";
import { draftFromDefinition, DRIVETRAIN_OPTIONS_TEXT, newDraftQuestion, type DraftPublishStatus, type DraftQuestion } from "../../../lib/scouting/form-builder";

/**
 * The form the builder opens on. Match first: it is what scouts need before the first match,
 * and "Set up scouting" used to open the pit form. `?type=pit` still opens the pit form.
 */
export function initialFormType(requested: string | null | undefined): EntryType {
  return requested === "pit" ? "pit" : "match";
}

export type FormStatusTone = "ready" | "draft" | "published" | "preview";

/**
 * The form's one status line, shown in the publish bar beside its one button.
 *
 * It used to be said three times: "Draft — not published" in the bar, a green "Ready to
 * publish" card with no button under it, and "Draft — not published · Draft saved on this
 * device" again above the questions. The bar now carries the readiness, the device draft and
 * the publish confirmation in one place.
 */
export function formStatusLine(input: {
  status: DraftPublishStatus;
  canManage: boolean;
  /** Publish is blocked right now (its reason is shown on its own). */
  publishBlocked: boolean;
  /** This editor just published the form shown. */
  justPublished: boolean;
  /** Where this editor's unpublished draft stands on the device. */
  draft: "saved" | "saving" | "unsaved" | null;
}): { label: string; detail: string; tone: FormStatusTone } {
  const { status } = input;
  if (!input.canManage) {
    return status.kind === "unpublished"
      ? {
          label: "No published form yet",
          detail: "Ask a scouting lead or team admin to publish a form. The questions below are a preview.",
          tone: "preview",
        }
      : { label: status.label, detail: "Live for your team.", tone: "published" };
  }
  if (status.kind === "published") {
    return {
      label: status.label,
      detail: input.justPublished ? "Scouts see this form the next time they open Scout." : status.detail,
      tone: "published",
    };
  }
  const draftNote =
    input.draft === "unsaved" ? "Draft not saved — keep this editor open."
    : input.draft === "saved" ? "Draft saved on this device."
    : input.draft === "saving" ? "Saving draft on this device…"
    : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  if (status.kind === "unpublished" && !input.publishBlocked) {
    return { label: "Ready to publish", detail: join("Start with these questions or tailor them below.", draftNote), tone: "ready" };
  }
  return { label: status.label, detail: join(status.detail, draftNote), tone: "draft" };
}

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
