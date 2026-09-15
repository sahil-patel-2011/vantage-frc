"use client";

import type { ReactNode } from "react";
import type { FieldDefinition } from "@vantage/scouting";
import { layoutMatchJobFields, layoutPitJobFields } from "../../lib/scouting/match-job-layout";

export function ScoutMatchJobFields({
  entryType,
  fields,
  renderField,
}: {
  entryType: "match" | "pit";
  fields: FieldDefinition[];
  renderField: (field: FieldDefinition) => ReactNode;
}) {
  if (entryType === "pit") {
    const sections = layoutPitJobFields(fields);
    if (!sections.length) {
      return <>{fields.map((field) => renderField(field))}</>;
    }
    return (
      <div className="scout-match-job">
        {sections.map((section) => (
          <section
            key={section.id}
            className="scout-match-job-section"
            id={`scout-pit-${section.id}`}
            aria-labelledby={`scout-pit-${section.id}-title`}
          >
            <header className="scout-studio-section">
              <h3 id={`scout-pit-${section.id}-title`}>{section.title}</h3>
              <p className="app-muted">{section.purpose}</p>
            </header>
            {section.fields.map((field) => renderField(field))}
          </section>
        ))}
      </div>
    );
  }

  const sections = layoutMatchJobFields(fields);
  if (!sections.length) {
    return <>{fields.map((field) => renderField(field))}</>;
  }

  return (
    <div className="scout-match-job">
      {sections.length > 1 ? (
        <nav className="scout-match-stage" aria-label="Match stages">
          {sections.map((section) => (
            <a key={section.phase} href={`#scout-phase-${section.phase}`}>
              {section.title}
            </a>
          ))}
        </nav>
      ) : null}
      {sections.map((section) => (
        <section
          key={section.phase}
          className="scout-match-job-section"
          id={`scout-phase-${section.phase}`}
          aria-labelledby={`scout-phase-${section.phase}-title`}
        >
          <header className="scout-studio-section">
            <h3 id={`scout-phase-${section.phase}-title`}>{section.title}</h3>
            <p className="app-muted">{section.purpose}</p>
          </header>
          {section.fields.map((field) => renderField(field))}
        </section>
      ))}
    </div>
  );
}
