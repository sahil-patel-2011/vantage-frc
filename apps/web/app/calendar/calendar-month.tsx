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
import {
  groupMeetingsByDay,
  type DayMeeting,
  type OverlayMeeting,
} from "../../lib/calendar/meetings-overlay";
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
 * What it adds: weekends are marked, because an FRC season happens on them —
 * and the team's real meetings, drawn under the season's milestones. A student
 * opening "the calendar" to find out whether there is practice on Thursday was
 * previously shown an empty square and concluded there was not. Those are
 * read-only here and owned by `/team/calendar`; see `meetings-overlay.ts`.
 */

const MAX_CHIPS_PER_DAY = 3;

function kindClass(kind: MilestoneKind): string {
  return `cal-grid-chip kind-${kind}`;
}

export type MonthViewProps = {
  milestones: readonly Milestone[];
  /** The team's meetings, shown but not editable here. */
  meetings?: readonly OverlayMeeting[];
  /** Where a meeting goes when pressed — the calendar that owns it. */
  meetingHref?: string;
  /** Saves a new whole-day milestone on `date`. Resolves when it has landed. */
  onCreate: (input: { title: string; startsOn: string }) => Promise<void>;
  /** Opens an existing entry — the list below is still the place to edit. */
  onOpen?: (milestone: Milestone) => void;
  busy?: boolean;
  /** Fixed "today" for tests; real clock otherwise. */
  today?: string;
};

export function CalendarMonth({
  milestones,
  meetings,
  meetingHref,
  onCreate,
  onOpen,
  busy,
  today,
}: MonthViewProps) {
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

  // An overlay rather than a second entry source for the grid: the grid draws
  // multi-day milestone spans, and a timed meeting has no span to draw.
  const meetingsByDay = useMemo(() => groupMeetingsByDay(meetings ?? []), [meetings]);

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
                meetings={meetingsByDay.get(day.date)}
                meetingHref={meetingHref}
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
  meetings,
  meetingHref,
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
  meetings?: DayMeeting[];
  meetingHref?: string;
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
  const dayMeetings = meetings ?? [];
  // Milestones take the visible slots first. A competition is the reason the
  // square matters; the build night that week is the ordinary case, and the
  // "N more" below counts whatever did not fit from either list.
  const visible = expanded ? day.entries : day.entries.slice(0, MAX_CHIPS_PER_DAY);
  const meetingBudget = expanded ? dayMeetings.length : Math.max(0, MAX_CHIPS_PER_DAY - visible.length);
  const visibleMeetings = dayMeetings.slice(0, meetingBudget);
  const hidden =
    day.entries.length - visible.length + (dayMeetings.length - visibleMeetings.length);
  const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div
      className="cal-grid-day"
      // The day this cell is, as itself. Without it the only way to point at a
      // cell is by position among cells matching some condition, and the
      // moment you change the cell — by adding to it — it stops matching and
      // the same expression silently means a different day.
      data-date={day.date}
      data-in-month={day.inMonth ? "yes" : "no"}
      data-today={day.isToday ? "yes" : "no"}
      data-weekend={day.isWeekend ? "yes" : "no"}
    >
      <span className="cal-grid-num">{day.dayOfMonth}</span>

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

        {/*
          A meeting is a link, not a button, because pressing it leaves for the
          calendar that owns it. Making it look like the milestone chips beside
          it and then behaving differently would be the worse lie — so it is
          quieter: a time, the title, and the subteam's colour down the edge.
        */}
        {visibleMeetings.map((meeting) => (
          <li key={`meeting-${meeting.id}`}>
            <a
              className="cal-grid-meeting"
              href={meetingHref ?? "/team?tab=calendar"}
              style={
                meeting.subteamColor
                  ? ({ "--meeting-accent": meeting.subteamColor } as React.CSSProperties)
                  : undefined
              }
              title={`${meeting.timeLabel} ${meeting.title}${
                meeting.subteamName ? ` — ${meeting.subteamName}` : ""
              } (on the team calendar)`}
            >
              <span className="cal-grid-meeting-time">{meeting.timeLabel}</span>
              <span className="cal-grid-meeting-title">{meeting.title}</span>
            </a>
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

      {/*
        "Add here" is the leftover space under the day's chips, and it is a
        real button with a real accessible name — reachable by tab, and it says
        which day it would add to.

        It was an absolutely-positioned overlay across the whole cell, which
        looked equivalent and was not: the chips sit above it, so on any day
        that already had something on it the middle of the cell was covered and
        pressing there did nothing. In normal flow it takes the space the chips
        do not, so there is always somewhere to press — and on a day with three
        chips, that is the strip underneath them.
      */}
      {composing ? null : (
        <button
          type="button"
          className="cal-grid-add"
          aria-label={`Add to ${label}`}
          disabled={busy}
          onClick={onStartCompose}
        />
      )}

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
