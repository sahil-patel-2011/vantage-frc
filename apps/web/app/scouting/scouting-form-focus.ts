import type { FieldDefinition } from "@vantage/scouting";
import { firstInvalidField } from "../../lib/scouting/invalid-fields";

/** Put the first invalid answer in view, including for long custom forms. */
export function focusInvalidScoutField(fields: FieldDefinition[], problems: string[]) {
  const field = firstInvalidField(fields, problems);
  const target = field ? document.getElementById(`scout-field-${encodeURIComponent(field.key)}`) : null;
  target?.scrollIntoView({ block: "center", behavior: "instant" });
  target?.querySelector<HTMLElement>("input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])")?.focus({ preventScroll: true });
}
