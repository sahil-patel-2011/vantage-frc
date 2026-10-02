"use client";

import { scoutOptionLabel } from "../../lib/scouting/option-label";
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
  const text = scoutOptionLabel(option);
  return text || option;
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
          {options.map((option, index) => {
            const active = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active || (!value && index === 0) ? 0 : -1}
                className={active ? "is-active" : undefined}
                onKeyDown={event => {
                  const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                  if (!direction && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length-1 : (index+direction+options.length)%options.length;
                  onChange(options[next]!.value);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}
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
