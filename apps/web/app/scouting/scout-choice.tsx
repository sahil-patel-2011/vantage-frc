"use client";

import { useId, type ReactNode } from "react";

export type ScoutChoiceOption = { value: string; label: string };

/**
 * A choice with a handful of short answers, as buttons in one row.
 *
 * Endgame (None / Park / Climb) and Broke down (No / Yes) used to be native
 * selects that opened at "Select…": two taps and a scroll wheel for an answer
 * a scout knows at a glance. A menu is still used when there are more than
 * four answers, or when the answers are too long to sit side by side on a
 * 390px phone.
 */
export function segmentedOptions(options: readonly string[] | undefined | null): ScoutChoiceOption[] | null {
  const list = options ?? [];
  if (list.length < 2 || list.length > 4) return null;
  if (list.some((option) => option.length > 14)) return null;
  return list.map((option) => ({ value: option, label: plainOption(option) }));
}

/** "none" → "None", "on_stage" → "On stage". The stored value is unchanged. */
export function plainOption(option: string): string {
  const text = option.replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : option;
}

/**
 * Not a <label>: a label wrapping buttons sends a tap on its text to the first
 * button, so tapping the word "Endgame" would have answered "None".
 */
export function ScoutChoiceRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="soft-form-row scout-choice-row">
      <span className="app-muted" id={labelId}>
        {label}
      </span>
      {children(labelId)}
      {hint ? <small className="app-muted">{hint}</small> : null}
    </div>
  );
}

export function ScoutChoice({
  label,
  hint,
  options,
  value,
  onChange,
  allowClear = true,
}: {
  label: string;
  hint?: string | null;
  options: ScoutChoiceOption[];
  value: string;
  onChange: (value: string | undefined) => void;
  /** Tapping the chosen answer again clears it, for a field that may stay blank. */
  allowClear?: boolean;
}) {
  return (
    <ScoutChoiceRow label={label} hint={hint}>
      {(labelId) => (
        <div
          className="scout-choice"
          role="radiogroup"
          aria-labelledby={labelId}
          style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
          {options.map((option) => {
            const active = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "is-active" : undefined}
                onClick={() => onChange(active && allowClear ? undefined : option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </ScoutChoiceRow>
  );
}
