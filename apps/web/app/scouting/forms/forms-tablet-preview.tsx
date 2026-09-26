"use client";

import { useMemo, useState } from "react";
import { isLayoutOnlyField } from "@vantage/scouting";
import { SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import { definitionFromDraft, type DraftQuestion } from "../../../lib/scouting/form-builder";
import { Field } from "../scouting-field";
import { ScoutChoice } from "../scout-choice";
import "../scout-flow.css";

/** The scout form's own confidence row, so the preview ends where the real form does. */
const CONFIDENCE_OPTIONS = [
  { value: "high", label: "Sure" },
  { value: "normal", label: "OK" },
  { value: "low", label: "Guessing" },
];

/**
 * What a scout sees, drawn by the scout form's own field component.
 *
 * The old preview drew plain number boxes and "Select…" dropdowns with
 * lowercase options, while the stands got −/+ steppers and big buttons. This
 * turns the draft into the same field list Publish would save and renders each
 * one with `Field`, inside a phone-width frame. Answers stay on this screen.
 */
export function FormsTabletPreview({ title, questions }: { title: string; questions: DraftQuestion[] }) {
  const definition = useMemo(() => definitionFromDraft(title, questions), [title, questions]);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState("normal");
  const answerable = definition.fields.filter((field) => !isLayoutOnlyField(field)).length;

  return (
    <div className="sfb-tablet" aria-label="Phone preview of the scout form">
      <div className="sfb-tablet-frame">
        <header className="sfb-tablet-head">
          <strong>{definition.title}</strong>
          <small className="app-muted">
            {answerable} {answerable === 1 ? "question" : "questions"} · answers here are not saved
          </small>
        </header>
        <div className="sfb-identity-lock" role="status">
          <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
          <strong>Signed-in member</strong>
          <small className="app-muted">{SCOUT_IDENTITY_LOCK_COPY.detail}</small>
        </div>
        {definition.fields.length === 0 ? (
          <p className="app-muted">Add a question to see it here.</p>
        ) : (
          definition.fields.map((field, index) => (
            <Field
              key={`${field.key}-${index}`}
              field={field}
              value={payload[field.key]}
              flags={[]}
              historyHint={null}
              disagreementRate={null}
              onChange={(value) => setPayload((current) => ({ ...current, [field.key]: value }))}
            />
          ))
        )}
        <ScoutChoice
          label="How sure are you?"
          options={CONFIDENCE_OPTIONS}
          value={confidence}
          allowClear={false}
          onChange={(next) => {
            if (next) setConfidence(next);
          }}
        />
      </div>
    </div>
  );
}
