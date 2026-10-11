/**
 * Which form a robot (or pit) opens on, and with which answers, when the lead has published a
 * new version since the scout started.
 *
 * Quick scout always opened the newest form and only reused a draft or an earlier report saved
 * under that exact version. A lead publishing between matches ("add a question about the new
 * defence rule") silently threw away every half-scouted robot (the four Auto points came back
 * "not counted"), and a robot the scout had already filed opened blank with no "you scouted
 * this already" note, so Save could replace a good report with an empty one.
 *
 * The full Scout form pins the form a draft was started on; this does the same:
 * - a draft finishes on the form it was started on (the draft keeps a copy of it);
 * - an earlier report reopens on the form it was saved under, once that form is loaded;
 * - if that form cannot be had (no signal, unreadable copy), the answers carry over to the new
 *   form for every question it still asks in the same shape, and the scout is told how many
 *   could not come along.
 *
 * Pure, so it is tested.
 */

import { MATCH_CAPTURE_KEY, validatePayload, type FieldDefinition, type ScoutSchema } from "@vantage/scouting";
import type { ScoutDraftSnapshot } from "./draft-autosave";

export type Confidence = "high" | "normal" | "low";

/** Your own saved report for this robot (bootstrap `myEntries`). */
export type EarlierReport = {
  clientId: string | null;
  schemaId?: string | null;
  payload: Record<string, unknown> | null;
  confidence?: string | null;
};

export type RobotFormChoice =
  | {
      kind: "ready";
      schema: ScoutSchema;
      payload: Record<string, unknown> | null;
      clientId: string | null;
      confidence: Confidence;
      /** Where the answers came from. */
      from: "draft" | "earlier" | "blank";
      /** You already filed this robot: Save replaces that report. */
      editing: boolean;
      /** When the draft was last kept on this phone, for "Your answers from 3 min ago are back". */
      draftSavedAt: string | null;
      /** One sentence about the form version, or null when nothing changed. */
      note: string | null;
    }
  /** The earlier form has to be fetched first (it is not on this phone). */
  | { kind: "fetch"; schemaId: string };

function confidenceOf(value: string | null | undefined): Confidence {
  return value === "high" || value === "low" ? value : "normal";
}

/** Would this one answer be valid on this question? Rules about other questions are ignored. */
function answerFits(field: FieldDefinition, value: unknown): boolean {
  const alone: FieldDefinition = { ...field, required: false, visibleWhen: null };
  return validatePayload({ title: "", fields: [alone] }, { [field.key]: value }).length === 0;
}

/**
 * Move answers onto another version of the form: each answer to a question the new form still
 * asks, in a shape it accepts, comes along; timed actions (not tied to a question) come too.
 * The undo log is left behind because it names questions the new form may not have.
 */
export function carryAnswersToForm(
  payload: Record<string, unknown>,
  fields: readonly FieldDefinition[],
): { payload: Record<string, unknown>; dropped: number } {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const carried: Record<string, unknown> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (key === MATCH_CAPTURE_KEY) {
      carried[key] = value;
      continue;
    }
    if (key.startsWith("_")) continue;
    if (value === undefined || value === null || value === "") continue;
    const field = byKey.get(key);
    if (field && answerFits(field, value)) carried[key] = value;
    else dropped += 1;
  }
  return { payload: carried, dropped };
}

export const FORM_PINNED_NOTE =
  "Your team updated this form while you were scouting. You are finishing on the form you started; the next one uses the new form.";
export const EARLIER_FORM_NOTE = "This report was saved on an earlier version of the form, so it opens on that version.";

function carriedNote(dropped: number): string {
  if (!dropped) return "Your team updated this form. Every answer you had carried over to the new version.";
  return `Your team updated this form. Your answers carried over, except ${dropped === 1 ? "1 answer to a question" : `${dropped} answers to questions`} the new version changed or no longer asks.`;
}

export function chooseRobotForm(input: {
  live: ScoutSchema;
  draft: ScoutDraftSnapshot | null;
  earlier: EarlierReport | null;
  /** Older versions of this form already on hand, by id. */
  known?: ReadonlyMap<string, ScoutSchema>;
  /** Earlier versions that could not be loaded (no signal): carry the answers over instead of waiting. */
  unavailable?: ReadonlySet<string>;
}): RobotFormChoice {
  const { live, draft, earlier } = input;
  const editing = Boolean(earlier?.payload);
  const known = (id: string) => {
    const schema = input.known?.get(id);
    return schema && schema.id === id && schema.type === live.type ? schema : null;
  };

  if (draft) {
    const base = { clientId: draft.clientId ?? earlier?.clientId ?? null, confidence: draft.confidence, from: "draft" as const, editing, draftSavedAt: draft.savedAt };
    if (!draft.schemaId || draft.schemaId === live.id) return { kind: "ready", schema: live, payload: draft.payload, note: null, ...base };
    const pinned = draft.schema && draft.schema.id === draft.schemaId && draft.schema.type === live.type ? draft.schema : known(draft.schemaId);
    if (pinned) return { kind: "ready", schema: pinned, payload: draft.payload, note: FORM_PINNED_NOTE, ...base };
    if (!input.unavailable?.has(draft.schemaId)) return { kind: "fetch", schemaId: draft.schemaId };
    const carried = carryAnswersToForm(draft.payload, live.definition.fields);
    return { kind: "ready", schema: live, payload: carried.payload, note: carriedNote(carried.dropped), ...base };
  }

  if (earlier?.payload) {
    const base = { clientId: earlier.clientId, confidence: confidenceOf(earlier.confidence), from: "earlier" as const, editing: true, draftSavedAt: null };
    if (!earlier.schemaId || earlier.schemaId === live.id) return { kind: "ready", schema: live, payload: earlier.payload, note: null, ...base };
    const original = known(earlier.schemaId);
    if (original) return { kind: "ready", schema: original, payload: earlier.payload, note: EARLIER_FORM_NOTE, ...base };
    if (!input.unavailable?.has(earlier.schemaId)) return { kind: "fetch", schemaId: earlier.schemaId };
    const carried = carryAnswersToForm(earlier.payload, live.definition.fields);
    return { kind: "ready", schema: live, payload: carried.payload, note: carriedNote(carried.dropped), ...base };
  }

  return { kind: "ready", schema: live, payload: null, clientId: null, confidence: "normal", from: "blank", editing: false, draftSavedAt: null, note: null };
}
