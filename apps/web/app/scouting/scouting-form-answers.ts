import type { ScoutSchema } from "@vantage/scouting";
import { stripHiddenAnswers, withInferredPhaseRules } from "../../lib/scouting/context-visible";
import { isTapCounterField } from "./scouting-field";

type FormField = ScoutSchema["definition"]["fields"][number];

/**
 * What Save sends: the answers still on screen (hidden ones dropped), only for questions the
 * form has, and a required counted number the scout never tapped saved as the 0 it showed.
 */
export function answersToSave(fields: FormField[], payload: Record<string, unknown>): Record<string, unknown> {
  const shown = stripHiddenAnswers(withInferredPhaseRules(fields), payload);
  const known = new Set(fields.map((field) => field.key));
  const answers = Object.fromEntries(Object.entries(shown).filter(([key]) => known.has(key)));
  for (const field of fields) {
    if (field.required && answers[field.key] === undefined && isTapCounterField(field)) answers[field.key] = 0;
  }
  return answers;
}
