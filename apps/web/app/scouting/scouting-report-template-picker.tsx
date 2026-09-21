"use client";

import { useMemo, useState } from "react";
import type { FieldDefinition } from "@vantage/scouting";
import {
  fieldsForReportTemplate,
  SCOUTING_REPORT_TEMPLATES,
  type ScoutingReportTemplateCategory,
} from "./scouting-report-templates";

const CATEGORIES: readonly ScoutingReportTemplateCategory[] = [
  "Match phase",
  "Robot role",
  "Event format",
];

export function ScoutingReportTemplatePicker({ fields }: { fields: readonly FieldDefinition[] }) {
  const [templateId, setTemplateId] = useState("");
  const template = SCOUTING_REPORT_TEMPLATES.find((candidate) => candidate.id === templateId);
  const matchedFields = useMemo(
    () => (template ? fieldsForReportTemplate(fields, template) : []),
    [fields, template],
  );

  function jumpToField(field: FieldDefinition) {
    const target = document.getElementById(`scout-field-${encodeURIComponent(field.key)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLElement>("button, input, select, textarea")?.focus({ preventScroll: true });
  }

  return (
    <section className="scout-template-picker" aria-labelledby="scout-template-title">
      <div className="scout-template-copy">
        <span className="eyebrow">Quick start</span>
        <strong id="scout-template-title">Report template</strong>
        <p>Choose a focus for this report. Your full form stays available and every metric remains editable.</p>
      </div>
      <label>
        <span className="app-muted">Template</span>
        <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">Choose a template…</option>
          {CATEGORIES.map((category) => (
            <optgroup key={category} label={category}>
              {SCOUTING_REPORT_TEMPLATES.filter((candidate) => candidate.category === category).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {template ? (
        <div className="scout-template-result" role="status">
          <p>{template.description}</p>
          {matchedFields.length ? (
            <div className="scout-template-metrics" aria-label="Template metrics">
              {matchedFields.map((field) => (
                <button key={field.key} type="button" onClick={() => jumpToField(field)}>
                  {field.label}
                </button>
              ))}
            </div>
          ) : (
            <small className="app-muted">This form has no matching metrics; choose another template or use the full form below.</small>
          )}
        </div>
      ) : null}
    </section>
  );
}
