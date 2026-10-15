"use client";

import { useEffect, useId, useState } from "react";
import { MarkdownDocument } from "../../../../team/knowledge/markdown-document";

/**
 * What every editor field takes so "Finish these before publishing" can link to it:
 * `fieldKey` (see lessonPublishIssues) marks the field for focusLessonField, and `invalid`
 * outlines it while that problem is listed.
 */
type IssueProps = { fieldKey?: string; invalid?: boolean };

/**
 * Puts the cursor in the field a publish problem is about: the exact field when it is on the
 * page, else its step or question card (a step shown as a preview has no text box), scrolled
 * into the middle of the screen.
 */
export function focusLessonField(field: string): void {
  const [kind, id] = field.split(":");
  const root =
    document.querySelector<HTMLElement>(`[data-lesson-field="${field}"]`) ??
    (id ? document.querySelector<HTMLElement>(`[data-lesson-field="${kind}:${id}"]`) : null);
  if (!root) return;
  const candidates = root.matches("input, textarea")
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>("input:not([type=radio]), textarea, button"));
  // The first one a person can actually type in or press (not the hidden file picker).
  const target =
    candidates.find((element) => !element.hidden && !(element as HTMLInputElement).disabled && element.getClientRects().length > 0) ?? root;
  if (target === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  root.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}

/**
 * A number typed as text, so "1." and "-" survive while someone is typing. The parent gets a
 * number (or null when empty); anything that isn't a number yet stays on screen, unsaved, with
 * a hint, instead of being replaced.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
  hint,
  suffix,
  fieldKey,
  invalid = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  hint?: string;
  suffix?: string;
} & IssueProps) {
  const id = useId();
  const [raw, setRaw] = useState(value === null ? "" : String(value));
  const [problem, setProblem] = useState<string | null>(null);

  // Follow outside changes (a restore, a reload), but not our own echo.
  useEffect(() => {
    setRaw((current) => {
      const parsed = current.trim() === "" ? null : Number(current);
      return parsed === value ? current : value === null ? "" : String(value);
    });
  }, [value]);

  function read(text: string) {
    setRaw(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setProblem(null);
      onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    const bad =
      !Number.isFinite(parsed) ||
      (integer && !Number.isInteger(parsed)) ||
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max);
    if (bad) {
      setProblem(hint ?? "Enter a number.");
      return;
    }
    setProblem(null);
    onChange(parsed);
  }

  return (
    <label className="team-lesson-field" htmlFor={id} data-lesson-field={fieldKey}>
      <span>{label}</span>
      <span className="team-lesson-answer-row">
        <input
          id={id}
          className="team-lesson-input"
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          value={raw}
          aria-invalid={problem || invalid ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => read(event.target.value)}
        />
        {suffix ? <span className="team-lesson-unit">{suffix}</span> : null}
      </span>
      {problem ? (
        <small id={`${id}-problem`} className="team-lesson-field-problem">
          {problem}
        </small>
      ) : null}
    </label>
  );
}

/** A markdown textarea with a Write / Preview toggle, previewed by the team wiki's renderer. */
export function MarkdownField({
  label,
  value,
  onChange,
  maxLength,
  rows = 6,
  optional = false,
  placeholder,
  fieldKey,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows?: number;
  optional?: boolean;
  placeholder?: string;
} & IssueProps) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const near = value.length > maxLength * 0.9;
  return (
    <div className="team-lesson-field" data-lesson-field={fieldKey}>
      <div className="team-lesson-field-head">
        <label htmlFor={id}>
          {label}
          {optional ? <span className="app-muted"> (optional)</span> : null}
        </label>
        <button type="button" className="team-lesson-toggle" aria-pressed={preview} onClick={() => setPreview((on) => !on)}>
          {preview ? "Write" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="team-lesson-md team-lesson-preview" aria-label={`${label} preview`}>
          {value.trim() ? <MarkdownDocument source={value} /> : <p className="app-muted">Nothing written yet.</p>}
        </div>
      ) : (
        <textarea
          id={id}
          className="team-lesson-input"
          rows={rows}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <small className="app-muted">
        **bold**, *italic*, `code`, lists with - or 1., ``` for code blocks, [links](https://…).
        {near ? ` ${value.length} of ${maxLength} characters.` : ""}
      </small>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  optional = false,
  placeholder,
  multiline = false,
  fieldKey,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  optional?: boolean;
  placeholder?: string;
  multiline?: boolean;
} & IssueProps) {
  const id = useId();
  return (
    <label className="team-lesson-field" htmlFor={id} data-lesson-field={fieldKey}>
      <span>
        {label}
        {optional ? <span className="app-muted"> (optional)</span> : null}
      </span>
      {multiline ? (
        <textarea
          id={id}
          className="team-lesson-input"
          rows={3}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="team-lesson-input"
          type="text"
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
