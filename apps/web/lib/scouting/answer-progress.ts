import { isEmptyScoutAnswer, isLayoutOnlyField, type FieldDefinition } from "@vantage/scouting";

/** Pass the reachable fields, not every question in the published form. */
export function scoutAnswerProgress(fields: readonly FieldDefinition[], payload: Record<string, unknown>) {
  const questions = fields.filter(field => !isLayoutOnlyField(field));
  const unanswered = questions.filter(field => isEmptyScoutAnswer(field, payload[field.key]));
  return {
    total: questions.length,
    answered: questions.length - unanswered.length,
    requiredRemaining: unanswered.filter(field => field.required),
    optionalRemaining: unanswered.filter(field => !field.required).length,
  };
}
