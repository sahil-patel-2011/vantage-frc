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
import { describeMove, moveByDays, moveToDate } from "../../lib/calendar/move-entry";
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
  /**
   * Moves an entry to a different day. Absent means the grid is read-only and
   * nothing advertises a move it cannot do.
   */
  onMove?: (milestone: Milestone, toDate: string) => Promise<void>;
  busy?: boolean;
  /** Fixed "today" for tests; real clock otherwise. */
  today?: string;
  /**
   * The month now on screen, `YYYY-MM`, whenever it changes.
   *
   * The grid still owns which month it is showing — this only reports it, so
   * the list underneath can be about the same month the grid is about.
   */
  onMonthChange?: (month: string) => void;
};

export function CalendarMonth({
  milestones,
  meetings,
  meetingHref,
  onCreate,
  onOpen,
  onMove,
  busy,
  today,
  onMonthChange,
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

  useEffect(() => {
    onMonthChange?.(month);
  }, [month, onMonthChange]);

  // The entry being dragged, and the day it is currently over. Both live here
  // rather than in the cells so a drag that ends outside the grid still clears.
  const [dragging, setDragging] = useState<Milestone | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState("");

  const move = useCallback(
    async (milestone: Milestone, toDate: string) => {
      if (!onMove) return;
      const patch = moveToDate(milestone, toDate);
      // Dropped where it already was, or onto something that is not a day.
      // Not an error, and not a write.
      if (!patch) return;
      setMoved(`${milestone.title}: ${describeMove(patch)}`);
      await onMove(milestone, toDate);
    },
    [onMove],
  );

  /**
   * Dragging, on pointer events rather than HTML5 drag-and-drop.
   *
   * HTML5 DnD does not fire for touch at all, and a mentor rescheduling a
   * scrimmage is usually doing it on a phone in the shop. Pointer events are
   * one API for mouse, pen and finger, so the feature exists on the device
   * people actually hold.
   *
   * The day under the pointer is found by hit-testing rather than by listening
   * on each cell: during a pointer capture every event is delivered to the
   * chip, so the cells never hear about the pointer crossing them.
   */
  const startDrag = useCallback(
    (milestone: Milestone, event: PointerEvent) => {
      if (!onMove || event.button !== 0) return;
      const chip = event.currentTarget as HTMLElement | null;
      const originX = event.clientX;
      const originY = event.clientY;
      let armed = false;

      const dayUnder = (x: number, y: number): string | null => {
        const element = document.elementFromPoint(x, y);
        const cell = element?.closest?.(".cal-grid-day") as HTMLElement | null;
        return cell?.dataset.date ?? null;
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!armed) {
          // A press is a click until it has travelled far enough to be a
          // drag. Without the threshold, opening an entry by tapping it
          // becomes a move to wherever the finger settled.
          if (Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 6) return;
          armed = true;
          setDragging(milestone);
        }
        moveEvent.preventDefault();
        setOver(dayUnder(moveEvent.clientX, moveEvent.clientY));
      };

      const finish = (endEvent: PointerEvent) => {
        chip?.releasePointerCapture?.(endEvent.pointerId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        if (!armed) return;
        const date = dayUnder(endEvent.clientX, endEvent.clientY);
        setDragging(null);
        setOver(null);
        // Dropped outside the grid: put it back rather than guessing.
        if (date) void move(milestone, date);
      };

      const cancel = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        setDragging(null);
        setOver(null);
      };

      chip?.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    },
    [onMove, move],
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

      /*
        With an entry focused the arrows move the entry, not the month.

        This is the whole keyboard path for moving something, and it has to be
        the arrows: they are already under the finger of anybody who has
        tabbed to a chip, and a separate "move mode" with its own modifier is
        a thing people have to be told about. Left and right are a day, up and
        down are a week — which is the shape of the grid, and also how a
        schedule actually slips.
      */
      const chip = target?.closest?.(".cal-grid-chip") as HTMLElement | null;
      const id = chip?.dataset.milestoneId;
      if (id && onMove) {
        const delta =
          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1
          : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
        if (delta !== 0) {
          const milestone = milestones.find((row) => row.id === id);
          const patch = milestone ? moveByDays(milestone, delta) : null;
          if (milestone && patch?.startsOn) {
            event.preventDefault();
            setMoved(`${milestone.title}: ${describeMove(patch)}`);
            void onMove(milestone, patch.startsOn);
            return;
          }
        }
      }

      if (event.key === "ArrowLeft") setMonth((current) => shiftMonth(current, -1));
      else if (event.key === "ArrowRight") setMonth((current) => shiftMonth(current, 1));
      else if (event.key.toLowerCase() === "t") setMonth(monthOf(resolvedToday));
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedToday, milestones, onMove]);

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
                canMove={Boolean(onMove)}
                dragging={dragging}
                isOver={over === day.date}
                onDragEntry={startDrag}
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

      {/*
        A move that leaves no trace is a move somebody has to go and verify.
        Announced rather than shown as a toast: the grid already redraws, so
        the only thing missing was for a screen reader to be told.
      */}
      <p className="sr-only cal-grid-said" aria-live="polite">
        {moved}
      </p>

      <p className="cal-grid-hint">
        Press a day to add something to it. Arrow keys change month; T comes back to today.
        {onMove ? " Drag an entry to move it, or focus one and use the arrow keys." : ""}
      </p>
    </section>
  );
}

function DayCell({
  day,
  meetings,
  meetingHref,
  canMove,
  dragging,
  isOver,
  onDragEntry,
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
  canMove: boolean;
  dragging: Milestone | null;
  isOver: boolean;
  onDragEntry: (milestone: Milestone, event: PointerEvent) => void;
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
      data-drop={isOver && dragging ? "yes" : undefined}
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
              data-milestone-id={entry.milestone.id}
              data-draggable={
                canMove && (entry.span === "single" || entry.span === "start") ? "yes" : undefined
              }
              // Only the first day of a span is the handle. Dragging the
              // middle of a three-day competition has no obvious meaning —
              // does it move, or does it resize? — so it does not offer to.
              onPointerDown={
                canMove && (entry.span === "single" || entry.span === "start")
                  ? (event) => onDragEntry(entry.milestone, event.nativeEvent)
                  : undefined
              }
              title={
                canMove
                  ? `${entry.milestone.title} — ${KIND_LABELS[entry.milestone.kind]}. Drag to move, or focus it and use the arrow keys.`
                  : `${entry.milestone.title} — ${KIND_LABELS[entry.milestone.kind]}`
              }
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
