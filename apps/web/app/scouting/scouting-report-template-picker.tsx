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

  return (
    <section className="scout-template-picker" aria-labelledby="scout-template-title">
      <div className="scout-template-copy">
        <span className="eyebrow">Quick start</span>
        <strong id="scout-template-title">What are you watching?</strong>
        <p>Tap a focus. The form stays complete, and the matching fields jump into reach.</p>
      </div>
      {CATEGORIES.map((category) => (
        <div className="scout-template-group" key={category}>
          <span className="scout-template-category">{category}</span>
          <div className="scout-template-choices" role="group" aria-label={category}>
            {SCOUTING_REPORT_TEMPLATES.filter((candidate) => candidate.category === category).map((candidate) => {
              const count = counts.get(candidate.id) ?? 0;
              const selected = templateId === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={count === 0}
                  title={count === 0 ? "This form has no fields for that focus" : candidate.description}
                  onClick={() => choose(selected ? "" : candidate.id)}
                >
                  <span>{candidate.name}</span>
                  <small>{count === 0 ? "None on this form" : `${count} field${count === 1 ? "" : "s"}`}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
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
