import { ACTION_HISTORY_KEY, type ScoutSchema } from "@vantage/scouting";
import { stripHiddenAnswers, withInferredPhaseRules } from "./context-visible";
import { isTapCounterField } from "./count-field";

/** Save visible answers plus their history, preserving required counters' displayed zero. */
export function answersToSave(fields: ScoutSchema["definition"]["fields"], payload: Record<string, unknown>): Record<string, unknown> {
  const shown = stripHiddenAnswers(withInferredPhaseRules(fields), payload);
  const known = new Set(fields.map((field) => field.key));
  const answers = Object.fromEntries(Object.entries(shown).filter(([key]) => known.has(key)));
  if (payload[ACTION_HISTORY_KEY]) answers[ACTION_HISTORY_KEY] = payload[ACTION_HISTORY_KEY];
  for (const field of fields) {
    if (field.required && answers[field.key] === undefined && isTapCounterField(field)) answers[field.key] = 0;
  }
  return answers;
}
