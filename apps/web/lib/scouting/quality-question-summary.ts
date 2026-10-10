import type { SchemaDefinition } from "@vantage/scouting";
import { officialComparisonForField } from "@vantage/scouting/official-fields";
import { summarizeFieldTrust, type FieldValidationStatus } from "@vantage/scouting/trust";
import type { QualityQuestionEvidence } from "./quality-evidence";

type OriginalForm = { id: string; year: number; type: "match" | "pit"; version: number; definition: SchemaDefinition };

/** Version-scoped summaries never borrow the latest form's question labels or meaning. */
export function summarizeOriginalQuestionTrust(
  rows: readonly { schemaId: string; fieldKey: string; status: FieldValidationStatus }[],
  forms: readonly OriginalForm[],
): QualityQuestionEvidence[] {
  const originals = new Map(forms.map(form => [form.id, form]));
  const fields = new Map(forms.map(form => [form.id, new Map(form.definition.fields.map(field => [field.key, field]))]));
  const byForm = new Map<string, Array<{ fieldKey: string; status: FieldValidationStatus }>>();
  for (const row of rows) {
    const original = originals.get(row.schemaId);
    const question = fields.get(row.schemaId)?.get(row.fieldKey);
    if (original?.type !== "match" || !question || !officialComparisonForField(question).kind) continue;
    const observations = byForm.get(row.schemaId) ?? [];
    observations.push(row);
    byForm.set(row.schemaId, observations);
  }
  return [...byForm].flatMap(([schemaId, observations]) => {
    const original = originals.get(schemaId)!;
    const labels = new Map(original.definition.fields.map(field => [field.key, field.label]));
    return summarizeFieldTrust(observations).map(summary => ({ ...summary, schemaId,
      label: labels.get(summary.fieldKey)!, formTitle: original.definition.title, year: original.year, version: original.version }));
  }).sort((a, b) => (b.disagreementRate ?? -1) - (a.disagreementRate ?? -1) || b.checks - a.checks || b.year - a.year || b.version - a.version || a.schemaId.localeCompare(b.schemaId) || a.fieldKey.localeCompare(b.fieldKey));
}
