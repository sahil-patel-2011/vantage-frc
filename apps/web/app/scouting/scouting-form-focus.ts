import type { FieldDefinition } from "@vantage/scouting";

/** Avoid matching "Fuel passed is required" to a different question named "Fuel". */
export function scoutFieldProblem(field: FieldDefinition, fields: FieldDefinition[], problems: string[]): string | undefined {
  return problems.find(problem => problem.startsWith(`${field.label} `) && !fields.some(other => other.label.length > field.label.length && problem.startsWith(`${other.label} `)));
}

/** Put the first invalid answer in view, including for long custom forms. */
export function focusInvalidScoutField(fields: FieldDefinition[], problems: string[]) {
  const field = fields.find(field => scoutFieldProblem(field, fields, problems));
  const target = field ? document.getElementById(`scout-field-${encodeURIComponent(field.key)}`) : null;
  const destination = target ?? document.getElementById("scout-validation-summary");
  destination?.scrollIntoView({ block: "center", behavior: "instant" });
  const control = target?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])')
    ?? target?.querySelector<HTMLElement>('[role="radio"][tabindex="0"],button:not([disabled])');
  (control ?? destination)?.focus({ preventScroll: true });
}
