import { ACTION_HISTORY_KEY, MATCH_CAPTURE_KEY, type ScoutSchema } from "@vantage/scouting";
import { stripHiddenAnswers, withInferredPhaseRules } from "./context-visible";

/** Save observed answers and their history. A required question never invents a zero. */
export function answersToSave(fields: ScoutSchema["definition"]["fields"], payload: Record<string, unknown>): Record<string, unknown> {
  const shown = stripHiddenAnswers(withInferredPhaseRules(fields), payload);
  const known = new Set(fields.map((field) => field.key));
  const answers = Object.fromEntries(Object.entries(shown).filter(([key]) => known.has(key)));
  if (payload[ACTION_HISTORY_KEY]) answers[ACTION_HISTORY_KEY] = payload[ACTION_HISTORY_KEY];
  if (payload[MATCH_CAPTURE_KEY] !== undefined) answers[MATCH_CAPTURE_KEY] = payload[MATCH_CAPTURE_KEY];
  return answers;
}
