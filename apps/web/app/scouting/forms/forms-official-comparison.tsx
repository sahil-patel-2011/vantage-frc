"use client";

import { officialComparisonForField, supportsOfficialComparison, type OfficialComparisonMode } from "@vantage/scouting/official-fields";
import type { FieldDefinition } from "@vantage/scouting";
import { FormRow } from "../../../components/ui";
import type { DraftQuestion } from "../../../lib/scouting/form-builder";

const options: ReadonlyArray<{ value: OfficialComparisonMode; label: string }> = [
  { value: "auto", label: "Automatic" },
  { value: "none", label: "No official check" },
  { value: "climb", label: "Climb outcome" },
  { value: "mobility", label: "Auto mobility" },
  { value: "foul", label: "Robot fouls (when posted)" },
];

export function FormsOfficialComparison({ question, field, index, disabled, onChange }: {
  question: DraftQuestion; field: FieldDefinition; index: number; disabled: boolean; onChange: (mode: OfficialComparisonMode) => void;
}) {
  const comparison = officialComparisonForField(field);
  return <FormRow label="Official match check" hint={`${comparison.message} Missing official values stay unknown.`}>
    <select value={question.officialComparison ?? "auto"} disabled={disabled}
      aria-label={`Official check for question ${index + 1}`} onChange={event => onChange(event.target.value as OfficialComparisonMode)}>
      {options.map(option => <option key={option.value} value={option.value}
        disabled={option.value !== "auto" && option.value !== "none" && !supportsOfficialComparison(field.type, option.value)}>
        {option.label}
      </option>)}
    </select>
  </FormRow>;
}
