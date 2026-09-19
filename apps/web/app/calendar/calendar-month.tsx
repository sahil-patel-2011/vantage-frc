"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildMonthGrid,
  localToday,
  monthLabel,
  monthOf,
  shiftMonth,
  type GridDay,
} from "../../lib/calendar/month-grid";
import { KIND_LABELS, type Milestone, type MilestoneKind } from "../../lib/season-calendar";

/**
 * A month you can look at.
 *
 * Calendar had no calendar — a list under month headings, which answers "what
 * is next" and cannot answer the questions a grid exists for: does the
 * scrimmage land on the same weekend as the grant deadline, how many build
 * nights are left before bag day, what does the week of the 14th look like.
 *
 * Deliberately *not* everything Google Calendar has. What it drops, and why:
 *
 *   - **No time grid.** A milestone is a whole day here; there are no start
 *     times to lay out, so an hour-by-hour column would be an empty ruler.
 *   - **No "Create" button.** The day you want is already on screen — press
 *     it and type. Google needs a button because its composer has to ask which
 *     day you meant; this one already knows.
 *   - **No guest list, no conferencing picker, no repeat rules** in the
 *     composer. One field. Everything else is on the milestone afterwards,
 *     where it is optional and most entries never need it.
 *
 * What it adds: weekends are marked, because an FRC season happens on them.
 */

const MAX_CHIPS_PER_DAY = 3;

function kindClass(kind: MilestoneKind): string {
  return `cal-grid-chip kind-${kind}`;
}

export type MonthViewProps = {
  milestones: readonly Milestone[];
  /** Saves a new whole-day milestone on `date`. Resolves when it has landed. */
  onCreate: (input: { title: string; startsOn: string }) => Promise<void>;
  /** Opens an existing entry — the list below is still the place to edit. */
  onOpen?: (milestone: Milestone) => void;
  busy?: boolean;
  /** Fixed "today" for tests; real clock otherwise. */
  today?: string;
};

export function CalendarMonth({ milestones, onCreate, onOpen, busy, today }: MonthViewProps) {
  const resolvedToday = today ?? localToday();
  const [month, setMonth] = useState(() => monthOf(resolvedToday));
  const [composingOn, setComposingOn] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  const grid = useMemo(
    () => buildMonthGrid(month, milestones, { today: resolvedToday }),
    [month, milestones, resolvedToday],
  );

  const closeComposer = useCallback(() => {
    setComposingOn(null);
    setDraft("");
  }, []);

  useEffect(() => {
    if (composingOn) composerRef.current?.focus();
  }, [composingOn]);

  /**
   * Arrow keys move months and `t` comes home — the two shortcuts people
   * actually use. Suppressed while typing so a title containing "t" does not
   * jump the month out from under the composer.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") setMonth((current) => shiftMonth(current, -1));
      else if (event.key === "ArrowRight") setMonth((current) => shiftMonth(current, 1));
      else if (event.key.toLowerCase() === "t") setMonth(monthOf(resolvedToday));
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedToday]);

  async function save(date: string) {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await onCreate({ title, startsOn: date });
      closeComposer();
    } finally {
      setSaving(false);
    }
  }

  const showingThisMonth = grid.month === monthOf(resolvedToday);

  return (
    <section className="cal-grid" aria-label={`${grid.label} calendar`}>
      <header className="cal-grid-head">
        <div className="cal-grid-move">
          <button
            type="button"
            className="cal-grid-arrow"
            aria-label={`Previous month, ${monthLabel(shiftMonth(grid.month, -1))}`}
            onClick={() => setMonth(shiftMonth(grid.month, -1))}
          >
            ‹
          </button>
          <h2 aria-live="polite">{grid.label}</h2>
          <button
            type="button"
            className="cal-grid-arrow"
            aria-label={`Next month, ${monthLabel(shiftMonth(grid.month, 1))}`}
            onClick={() => setMonth(shiftMonth(grid.month, 1))}
          >
            ›
          </button>
        </div>
        {/* Only offered when it would do something. A "Today" button on the
            month you are already looking at is a button that does nothing. */}
        {showingThisMonth ? null : (
          <button
            type="button"
            className="cal-grid-today"
            onClick={() => setMonth(monthOf(resolvedToday))}
          >
            Today
          </button>
        )}
      </header>

      <div className="cal-grid-weekdays" aria-hidden="true">
        {grid.weekdayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="cal-grid-weeks">
        {grid.weeks.map((week) => (
          <div className="cal-grid-week" key={week[0]!.date}>
            {week.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                composing={composingOn === day.date}
                draft={draft}
                saving={saving}
                busy={busy}
                expanded={expanded === day.date}
                onToggleExpanded={() =>
                  setExpanded((current) => (current === day.date ? null : day.date))
                }
                onStartCompose={() => {
                  setExpanded(null);
                  setComposingOn(day.date);
                  setDraft("");
                }}
                onDraft={setDraft}
                onCancel={closeComposer}
                onSave={() => void save(day.date)}
                onOpen={onOpen}
                composerRef={composerRef}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="cal-grid-hint">
        Press a day to add something to it. Arrow keys change month; T comes back to today.
      </p>
    </section>
  );
}

function DayCell({
  day,
  composing,
  draft,
  saving,
  busy,
  expanded,
  onToggleExpanded,
  onStartCompose,
  onDraft,
  onCancel,
  onSave,
  onOpen,
  composerRef,
}: {
  day: GridDay;
  composing: boolean;
  draft: string;
  saving: boolean;
  busy?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onStartCompose: () => void;
  onDraft: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onOpen?: (milestone: Milestone) => void;
  composerRef: React.RefObject<HTMLInputElement | null>;
}) {
  const visible = expanded ? day.entries : day.entries.slice(0, MAX_CHIPS_PER_DAY);
  const hidden = day.entries.length - visible.length;
  const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div
      className="cal-grid-day"
      data-in-month={day.inMonth ? "yes" : "no"}
      data-today={day.isToday ? "yes" : "no"}
      data-weekend={day.isWeekend ? "yes" : "no"}
    >
      {/*
        The empty area of the cell is the "add here" control, which is why it
        is a real button with a real accessible name rather than a click
        handler on a div: it has to be reachable by tab and by a screen reader,
        and it has to say which day it would add to.
      */}
      <button
        type="button"
        className="cal-grid-add"
        aria-label={`Add to ${label}`}
        disabled={busy}
        onClick={onStartCompose}
      >
        <span className="cal-grid-num">{day.dayOfMonth}</span>
      </button>

      <ul className="cal-grid-entries">
        {visible.map((entry) => (
          <li key={`${entry.milestone.id}-${day.date}`}>
            <button
              type="button"
              className={`${kindClass(entry.milestone.kind)} span-${entry.span}${
                entry.milestone.done ? " is-done" : ""
              }`}
              title={`${entry.milestone.title} — ${KIND_LABELS[entry.milestone.kind]}`}
              onClick={() => onOpen?.(entry.milestone)}
            >
              {/* A continued day repeats the title rather than showing a bare
                  bar: a cell read on its own should still say what it is. */}
              <span>{entry.milestone.title}</span>
            </button>
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <button type="button" className="cal-grid-more" onClick={onToggleExpanded}>
          {hidden} more
        </button>
      ) : expanded ? (
        <button type="button" className="cal-grid-more" onClick={onToggleExpanded}>
          Show less
        </button>
      ) : null}

      {composing ? (
        <form
          className="cal-grid-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <input
            ref={composerRef}
            value={draft}
            disabled={saving}
            placeholder="What is happening?"
            aria-label={`Title for a new entry on ${label}`}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            onBlur={() => {
              // Leaving an empty composer closes it. Leaving one with text in
              // it does not — losing typing to a stray click is the kind of
              // thing that stops people trusting a quick-add at all.
              if (!draft.trim()) onCancel();
            }}
          />
        </form>
      ) : null}
    </div>
  );
}
