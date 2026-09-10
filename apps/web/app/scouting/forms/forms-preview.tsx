"use client";

import { useMemo, useState } from "react";
import { DEFAULT_DRIVETRAIN_OPTIONS } from "@vantage/scouting";
import { StudioField } from "../studio-fields";
import { FormRow } from "../../../components/ui";
import {
  isStudioAnswerKind,
  parseOptions,
  previewFieldForQuestion,
  type DraftQuestion,
} from "../../../lib/scouting/form-builder";

/**
 * Live preview of one studio field.
 *
 * It renders the real entry control against the real published config, so what
 * a coach taps here is exactly what a scout will tap in the stands. State is
 * local and thrown away — nothing previewed is ever saved.
 */
function StudioPreviewField({ question }: { question: DraftQuestion }) {
  const field = useMemo(() => previewFieldForQuestion(question), [question]);
  const [value, setValue] = useState<unknown>(undefined);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;
  return <StudioField field={field} value={value} onChange={setValue} label={label} />;
}

export function PreviewField({ question }: { question: DraftQuestion }) {
  const options = parseOptions(question.optionsText);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;

  if (isStudioAnswerKind(question.kind)) {
    return <StudioPreviewField question={question} />;
  }
  if (question.kind === "yesno") {
    return (
      <label className="sfb-check">
        <input type="checkbox" disabled />
        <span>{label}</span>
      </label>
    );
  }
  if (question.kind === "mc") {
    return (
      <FormRow label={label}>
        <div className="sfb-radio-row" role="radiogroup">
          {(options.length ? options : ["Option A", "Option B"]).map((option) => (
            <label key={option}>
              <input type="radio" name={question.id} disabled />
              {option}
            </label>
          ))}
        </div>
      </FormRow>
    );
  }
  if (question.kind === "dropdown" || question.kind === "drivetrain") {
    const choices =
      question.kind === "drivetrain"
        ? options.length
          ? options
          : [...DEFAULT_DRIVETRAIN_OPTIONS]
        : options;
    return (
      <FormRow label={label}>
        <select disabled defaultValue="">
          <option value="">Select…</option>
          {choices.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </FormRow>
    );
  }
  if (question.kind === "robot_image") {
    return (
      <FormRow label={label} hint="Camera or gallery — stored per organization">
        <div className="sfb-robot-image-preview">
          <div className="sfb-robot-image-actions">
            <span className="app-button secondary" aria-disabled>
              Camera
            </span>
            <span className="app-button secondary" aria-disabled>
              Gallery
            </span>
          </div>
          <span className="app-muted">Live entry lets scouts capture or pick photos offline.</span>
        </div>
      </FormRow>
    );
  }
  if (question.kind === "free") {
    return (
      <FormRow label={label}>
        <textarea disabled placeholder="Free-text notes…" />
      </FormRow>
    );
  }
  return (
    <FormRow label={label}>
      <input
        type={question.kind === "number" ? "number" : "text"}
        disabled
        placeholder={question.kind === "number" ? "0" : "Short answer"}
      />
    </FormRow>
  );
}
