"use client";

/**
 * The repeat control and the "this / this and following / all events" chooser.
 *
 * A build season is "Tuesday and Thursday 6-9pm plus Saturday 10-4" for fourteen
 * weeks. Without this a mentor hand-creates ~50 events, so the control is
 * deliberately plain: pick a cadence, pick the days, say when it stops, and read
 * back the rule in English before saving it.
 */

import { useMemo } from "react";
import {
  describeRRule,
  draftToRRule,
  EMPTY_REPEAT_DRAFT,
  MAX_COUNT,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  WEEKDAYS,
  type RepeatDraft,
  type RepeatPreset,
  type Weekday,
} from "../../../lib/calendar/recurrence";

export { EMPTY_REPEAT_DRAFT };
export type { RepeatDraft };

const PRESET_LABELS: Record<RepeatPreset, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

const PRESETS: RepeatPreset[] = ["none", "daily", "weekly", "biweekly", "monthly"];

/** The browser's IANA zone, so "6pm" means 6pm in the shop. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Turn the control's state into the RRULE the API stores. Returns `{ rrule }` on
 * success or `{ error }` with a readable message — never a silently wrong rule.
 */
export function repeatDraftToRule(
  draft: RepeatDraft,
  startsAtIso: string,
  timeZone: string,
): { rrule: string | null; error: null } | { rrule: null; error: string } {
  try {
    return { rrule: draftToRRule(draft, { start: startsAtIso, timeZone }), error: null };
  } catch (error) {
    return { rrule: null, error: error instanceof Error ? error.message : "Invalid repeat" };
  }
}

export function RepeatControl({
  draft,
  onChange,
  startsAtIso,
  timeZone,
  disabled,
  idPrefix = "repeat",
}: {
  draft: RepeatDraft;
  onChange: (next: RepeatDraft) => void;
  /** ISO start, used for the weekday default and the summary. */
  startsAtIso: string | null;
  timeZone: string;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const weeklyish = draft.preset === "weekly" || draft.preset === "biweekly";

  const summary = useMemo(() => {
    if (draft.preset === "none" || !startsAtIso) return null;
    const built = repeatDraftToRule(draft, startsAtIso, timeZone);
    if (built.error) return { text: built.error, invalid: true };
    if (!built.rrule) return null;
    return {
      text: describeRRule(built.rrule, { start: startsAtIso, timeZone }),
      invalid: false,
    };
  }, [draft, startsAtIso, timeZone]);

  const toggleDay = (day: Weekday) => {
    const has = draft.days.includes(day);
    const days = has ? draft.days.filter((value) => value !== day) : [...draft.days, day];
    onChange({ ...draft, days: days.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)) });
  };

  return (
    <div className="tc-repeat">
      <label className="tc-field wide">
        <span>Repeat</span>
        <select
          value={draft.preset}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, preset: event.target.value as RepeatPreset })
          }
        >
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>

      {weeklyish ? (
        <fieldset className="tc-repeat-days" disabled={disabled}>
          <legend>On these days</legend>
          <div className="tc-repeat-day-row">
            {WEEKDAYS.map((day) => {
              const active = draft.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={active ? "tc-repeat-day active" : "tc-repeat-day"}
                  aria-pressed={active}
                  aria-label={WEEKDAY_LABELS[day]}
                  disabled={disabled}
                  onClick={() => toggleDay(day)}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              );
            })}
          </div>
          <p className="tc-muted tc-repeat-hint">
            Leave every day off to repeat on the start date&rsquo;s weekday.
          </p>
        </fieldset>
      ) : null}

      {draft.preset !== "none" ? (
        <div className="tc-repeat-end">
          <label className="tc-field">
            <span>Ends</span>
            <select
              value={draft.endMode}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, endMode: event.target.value as RepeatDraft["endMode"] })
              }
            >
              <option value="never">Never</option>
              <option value="on">On a date</option>
              <option value="after">After N times</option>
            </select>
          </label>
          {draft.endMode === "on" ? (
            <label className="tc-field">
              <span>Ends on</span>
              <input
                id={`${idPrefix}-ends-on`}
                type="date"
                value={draft.endsOn}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, endsOn: event.target.value })}
              />
            </label>
          ) : null}
          {draft.endMode === "after" ? (
            <label className="tc-field">
              <span>Times</span>
              <input
                id={`${idPrefix}-count`}
                type="number"
                min={1}
                max={MAX_COUNT}
                inputMode="numeric"
                value={draft.count}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...draft, count: Number(event.target.value) || 1 })
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <p className={summary.invalid ? "tc-repeat-summary invalid" : "tc-repeat-summary"}>
          {summary.invalid ? summary.text : `Repeats: ${summary.text}`}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Occurrence scope
 * ------------------------------------------------------------------ */

export type OccurrenceScope = "this" | "following" | "all";

const SCOPE_COPY: { value: OccurrenceScope; label: string; hint: string }[] = [
  { value: "this", label: "This event", hint: "Only the meeting you picked." },
  {
    value: "following",
    label: "This and following",
    hint: "Leaves past meetings alone and changes the rest.",
  },
  { value: "all", label: "All events", hint: "Every meeting in the series." },
];

/**
 * The standard three-way choice, shown before a change touches more than one
 * meeting. Rendered inline (not a native `confirm`) so the consequence of each
 * option is readable on a phone in the shop.
 */
export function OccurrenceScopeChoice({
  title,
  actionLabel,
  destructive,
  busy,
  onPick,
  onCancel,
}: {
  title: string;
  actionLabel: string;
  destructive?: boolean;
  busy: boolean;
  onPick: (scope: OccurrenceScope) => void;
  onCancel: () => void;
}) {
  return (
    <div className="tc-scope" role="group" aria-label={title}>
      <p className="tc-scope-title">{title}</p>
      <div className="tc-scope-options">
        {SCOPE_COPY.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              destructive && option.value !== "this"
                ? "tc-scope-btn danger"
                : "tc-scope-btn"
            }
            disabled={busy}
            onClick={() => onPick(option.value)}
          >
            <strong>
              {actionLabel} — {option.label}
            </strong>
            <span>{option.hint}</span>
          </button>
        ))}
      </div>
      <button type="button" className="tc-text-btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
