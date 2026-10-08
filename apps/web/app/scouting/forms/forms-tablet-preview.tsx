"use client";

import { useMemo, useState } from "react";
import { isLayoutOnlyField, type EntryType } from "@vantage/scouting";
import { visibleFields, withInferredPhaseRules } from "@vantage/scouting/visibility";
import { SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import { definitionFromDraft, type DraftQuestion } from "../../../lib/scouting/form-builder";
import { ScoutingAnswerField } from "../scouting-answer-field";
import { ScoutChoice } from "../scout-choice";
import { MatchFormControls } from "../match-timer";
import { fieldsForMatchStage, type ScoutFormStage } from "../../../lib/scouting/match-form-flow";
import { MEDIA_ENABLED } from "../../../lib/media-availability";
import type { OfficialFlag } from "../scouting-model";
import "../scout-flow.css";

/** The scout form's own confidence row, so the preview ends where the real form does. */
const CONFIDENCE_OPTIONS = [
  { value: "high", label: "Sure" },
  { value: "normal", label: "OK" },
  { value: "low", label: "Guessing" },
];
const NO_FLAGS: OfficialFlag[] = [];

/**
 * What a scout sees, drawn by the scout form's own field component.
 *
 * The old preview drew plain number boxes and "Select…" dropdowns with
 * lowercase options, while the stands got −/+ steppers and big buttons. This
 * turns the draft into the same field list Publish would save and renders each
 * one with `Field`, inside a phone-width frame. Answers stay on this screen.
 */
export function FormsTabletPreview({ title, questions, type }: { title: string; questions: DraftQuestion[]; type: EntryType }) {
  const definition = useMemo(() => definitionFromDraft(title, questions), [title, questions]);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState("normal");
  const [stage, setStage] = useState<ScoutFormStage>("pre");
  const phaseFields = useMemo(() => withInferredPhaseRules(definition.fields.filter(field => MEDIA_ENABLED || (field.type !== "robot_image" && field.widget !== "robot_image"))), [definition]);
  const reachable = visibleFields(phaseFields, payload);
  const displayed = type === "match" ? fieldsForMatchStage(reachable, stage) : reachable;
  const answerable = reachable.filter(field => !isLayoutOnlyField(field)).length;

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
        {type === "match" ? <MatchFormControls stage={stage} onStageChange={setStage} /> : null}
        {definition.fields.length > 0 && displayed.length === 0 ? <p className="app-muted">No questions for this phase. Use the phase controls to continue.</p> : null}
        {definition.fields.length === 0 ? (
          <p className="app-muted">Add a question to see it here.</p>
        ) : (
          displayed.map((field) => (
            <ScoutingAnswerField
              key={field.key}
              field={field}
              value={payload[field.key]}
              flags={NO_FLAGS}
              historyHint={null}
              disagreementRate={null}
              setPayload={setPayload}
            />
          ))
        )}
        {type === "pit" || stage === "review" ? <ScoutChoice
          label="How sure are you?"
          options={CONFIDENCE_OPTIONS}
          value={confidence}
          allowClear={false}
          onChange={(next) => {
            if (next) setConfidence(next);
          }}
        /> : null}
      </div>
    </div>
  );
}
