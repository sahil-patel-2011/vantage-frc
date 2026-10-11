"use client";

import { useEffect, useId, useState } from "react";
import { MarkdownDocument } from "../../../../team/knowledge/markdown-document";

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
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  hint?: string;
  suffix?: string;
}) {
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
    <label className="team-lesson-field" htmlFor={id}>
      <span>{label}</span>
      <span className="team-lesson-answer-row">
        <input
          id={id}
          className="team-lesson-input"
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          value={raw}
          aria-invalid={problem ? true : undefined}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows?: number;
  optional?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const near = value.length > maxLength * 0.9;
  return (
    <div className="team-lesson-field">
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  optional?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <label className="team-lesson-field" htmlFor={id}>
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
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
