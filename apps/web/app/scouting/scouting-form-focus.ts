import type { FieldDefinition } from "@vantage/scouting";

/** Put the first invalid answer in view, including for long custom forms. */
export function focusInvalidScoutField(fields: FieldDefinition[], problems: string[]) {
  const field = fields.find(field => problems.some(problem => problem.startsWith(`${field.label} `)));
  const target = field ? document.getElementById(`scout-field-${encodeURIComponent(field.key)}`) : null;
  target?.scrollIntoView({ block: "center", behavior: "instant" });
  target?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])")?.focus({ preventScroll: true });
}
