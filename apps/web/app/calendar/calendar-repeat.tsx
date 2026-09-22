"use client";

import { useCallback, useMemo, useState } from "react";
import {
  WEEKDAY_LABELS,
  describeRepeat,
  expandRepeat,
  type Weekday,
} from "../../lib/calendar/repeat";

/**
 * "Every Tuesday and Thursday until bag day", as seven buttons and a date.
 *
 * Deliberately not a rule builder. Google offers daily / weekly / monthly /
 * yearly / custom, and an FRC team uses exactly one shape of it — some set of
 * weeknights, until a date on the season calendar. Offering the other four
 * costs a dropdown, a second screen and a class of bug, and earns nothing.
 *
 * The count is shown before anything is created, because "Add 34 entries" is a
 * different decision from "Add milestone" and the person pressing it should be
 * told which one they are making.
 */

export type RepeatState = {
  weekdays: Weekday[];
  until: string;
  everyWeeks: number;
  dates: string[];
  truncated: boolean;
  summary: string;
  toggle: (day: Weekday) => void;
  setUntil: (value: string) => void;
  setEveryWeeks: (value: number) => void;
  reset: () => void;
};

export function useRepeatRule(startsOn: string): RepeatState {
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [until, setUntil] = useState("");
  const [everyWeeks, setEveryWeeks] = useState(1);

  const { dates, truncated } = useMemo(
    () => (startsOn ? expandRepeat(startsOn, { weekdays, until, everyWeeks }) : { dates: [], truncated: false }),
    [startsOn, weekdays, until, everyWeeks],
  );

  const toggle = useCallback((day: Weekday) => {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort(),
    );
  }, []);

  const reset = useCallback(() => {
    setWeekdays([]);
    setUntil("");
    setEveryWeeks(1);
  }, []);

  const summary = useMemo(
    () => describeRepeat({ weekdays, until, everyWeeks }, dates.length),
    [weekdays, until, everyWeeks, dates.length],
  );

  return { weekdays, until, everyWeeks, dates, truncated, summary, toggle, setUntil, setEveryWeeks, reset };
}

export function CalendarRepeat({
  state,
  disabled,
  startsOn,
}: {
  state: RepeatState;
  disabled?: boolean;
  startsOn: string;
}) {
  const repeating = state.weekdays.length > 0;
  return (
    <fieldset className="cal-repeat" disabled={disabled}>
      <legend>Repeat</legend>
      <div className="cal-repeat-days" role="group" aria-label="Days this repeats on">
        {WEEKDAY_LABELS.map((label, index) => {
          const day = index as Weekday;
          const on = state.weekdays.includes(day);
          return (
            <button
              key={label}
              type="button"
              className={on ? "is-on" : undefined}
              aria-pressed={on}
              // The visible label is one letter so seven of them fit on a
              // phone; the name a screen reader gets is the whole word.
              aria-label={label}
              onClick={() => state.toggle(day)}
            >
              {label.slice(0, 1)}
            </button>
          );
        })}
      </div>

      {repeating ? (
        <div className="cal-repeat-range">
          <label>
            <span>Until</span>
            <input
              type="date"
              value={state.until}
              min={startsOn || undefined}
              onChange={(event) => state.setUntil(event.target.value)}
            />
          </label>
          <label>
            <span>How often</span>
            <select
              value={state.everyWeeks}
              onChange={(event) => state.setEveryWeeks(Number(event.target.value))}
            >
              <option value={1}>Every week</option>
              <option value={2}>Every other week</option>
            </select>
          </label>
        </div>
      ) : null}

      {/* Said before anything is created: "Add 34 entries" is a different
          decision from "Add milestone". */}
      <p className="cal-repeat-summary" aria-live="polite">
        {!startsOn
          ? "Pick a start date first."
          : repeating && !state.until
            ? "Pick a date to repeat until."
            : state.summary}
        {state.truncated ? " — capped; shorten the date range." : ""}
      </p>
    </fieldset>
  );
}
