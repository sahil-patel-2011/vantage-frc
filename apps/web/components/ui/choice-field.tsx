"use client";

import { useId, type ReactNode } from "react";
import "./choice-field.css";

type Choice<T extends string> = { value: T; label: string; hint?: string; icon?: ReactNode };

/** Native radios keep arrow-key selection, form semantics, and one tab stop. */
export function ChoiceField<T extends string>({ label, value, choices, disabled, onChange }: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return <fieldset className="choice-field" disabled={disabled}>
    <legend className="sr-only">{label}</legend>
    <div className="choice-field-options">
      {choices.map(choice => <label key={choice.value} className="choice-field-option">
        <input type="radio" name={name} value={choice.value} checked={value === choice.value}
          aria-label={choice.label} onChange={() => onChange(choice.value)} />
        <span className="choice-field-copy">
          <span>{choice.icon ? <span aria-hidden="true">{choice.icon} </span> : null}{choice.label}</span>
          {choice.hint ? <small>{choice.hint}</small> : null}
        </span>
      </label>)}
    </div>
  </fieldset>;
}
