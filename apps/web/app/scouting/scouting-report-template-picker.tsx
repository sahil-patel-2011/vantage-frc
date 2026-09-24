"use client";

import { useEffect, useMemo, useState } from "react";
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

const STORAGE_KEY = "vantage-scout-report-template";

export function ScoutingReportTemplatePicker({ fields }: { fields: readonly FieldDefinition[] }) {
  const [templateId, setTemplateId] = useState("");
  const template = SCOUTING_REPORT_TEMPLATES.find((candidate) => candidate.id === templateId);
  const matchedFields = useMemo(
    () => (template ? fieldsForReportTemplate(fields, template) : []),
    [fields, template],
  );
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const candidate of SCOUTING_REPORT_TEMPLATES) {
      next.set(candidate.id, fieldsForReportTemplate(fields, candidate).length);
    }
    return next;
  }, [fields]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY) ?? "";
      if (SCOUTING_REPORT_TEMPLATES.some((candidate) => candidate.id === saved)) {
        setTemplateId(saved);
      }
    } catch {
      // Private mode can throw. The picker still works without a remembered choice.
    }
  }, []);

  function choose(nextId: string) {
    setTemplateId(nextId);
    try {
      if (nextId) sessionStorage.setItem(STORAGE_KEY, nextId);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Remembering the choice is a convenience, not part of the report.
    }
  }

  function jumpToField(field: FieldDefinition) {
    const target = document.getElementById(`scout-field-${encodeURIComponent(field.key)}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLElement>("button, input, select, textarea")?.focus({ preventScroll: true });
  }

  // One control, not a card. As a card of eleven buttons in three groups this
  // sat between the robot a scout had just tapped and the first field, and on
  // a phone it was most of a screen of scrolling before any counting could
  // start. It is optional — the form is complete without it — so it now takes
  // one row, and choosing a focus still lists the matching fields to jump to.
  return (
    <section className="scout-template-picker is-compact" aria-label="What are you watching?">
      <label className="scout-template-select">
        <span>What are you watching?</span>
        <select value={templateId} onChange={(event) => choose(event.target.value)}>
          <option value="">Everything</option>
          {CATEGORIES.map((category) => (
            <optgroup key={category} label={category}>
              {SCOUTING_REPORT_TEMPLATES.filter((candidate) => candidate.category === category).map((candidate) => {
                const count = counts.get(candidate.id) ?? 0;
                return (
                  <option key={candidate.id} value={candidate.id} disabled={count === 0}>
                    {candidate.name} · {count === 0 ? "none on this form" : `${count} field${count === 1 ? "" : "s"}`}
                  </option>
                );
              })}
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
            <small className="app-muted">This form has no matching metrics. Pick another focus, or fill the form below.</small>
          )}
        </div>
      ) : null}
    </section>
  );
}
