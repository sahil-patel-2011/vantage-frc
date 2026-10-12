import { ACTION_HISTORY_KEY, MATCH_CAPTURE_KEY, type ScoutSchema } from "@vantage/scouting";
import { stripHiddenAnswers, withInferredPhaseRules } from "./context-visible";
import { STATION_FIELD_KEY } from "./quick-scout";

/**
 * Answers the app fills in for the scout, which are not something they saw: the seat
 * ("Red 2") comes from the schedule the moment a robot is opened.
 */
const FILLED_FOR_THE_SCOUT = new Set([STATION_FIELD_KEY]);

function blankAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(blankAnswer);
  return false;
}

/**
 * Did the scout record anything at all? A pit visit or match saved with nothing answered
 * used to count as "visited" and "scouted", so the lead's meter went up with no data and
 * nobody walked back to that pit. A zero, a "No" and a timed action all count; the seat the
 * schedule filled in and the undo log do not.
 */
export function hasObservation(payload: Record<string, unknown> | null | undefined): boolean {
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (key === ACTION_HISTORY_KEY || FILLED_FOR_THE_SCOUT.has(key)) continue;
    if (key === MATCH_CAPTURE_KEY) {
      const bouts = (value as { bouts?: Array<{ voided?: boolean }> } | null)?.bouts;
      if (Array.isArray(bouts) && bouts.some((bout) => bout && !bout.voided)) return true;
      continue;
    }
    if (!blankAnswer(value)) return true;
  }
  return false;
}

export const NOTHING_RECORDED_REASON =
  "This report has no answers in it, so it was not saved. Answer at least one question, or discard it.";

/** Save observed answers and their history. A required question never invents a zero. */
export function answersToSave(fields: ScoutSchema["definition"]["fields"], payload: Record<string, unknown>): Record<string, unknown> {
  const shown = stripHiddenAnswers(withInferredPhaseRules(fields), payload);
  const known = new Set(fields.map((field) => field.key));
  const answers = Object.fromEntries(Object.entries(shown).filter(([key]) => known.has(key)));
  if (payload[ACTION_HISTORY_KEY]) answers[ACTION_HISTORY_KEY] = payload[ACTION_HISTORY_KEY];
  if (payload[MATCH_CAPTURE_KEY] !== undefined) answers[MATCH_CAPTURE_KEY] = payload[MATCH_CAPTURE_KEY];
  return answers;
}
