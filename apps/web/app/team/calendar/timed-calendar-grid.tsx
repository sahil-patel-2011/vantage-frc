"use client";

import { DayTasks } from "./task-chip";
import { WEEKDAYS, dayNum, fmtTime } from "./calendar-model";
import type { TaskOnCalendar } from "../../../lib/calendar/tasks-on-calendar";
import {
  CALENDAR_GRID_HOURS,
  formatHourLabel,
  isAllDayCalendarEvent,
  layoutTimedEventsForDay,
  overlayItemsForDay,
  type CalendarGridCell,
  type CalendarOverlayItem,
} from "../../../lib/subteam-calendar";

export function TimedCalendarGrid({
  cells,
  githubItems,
  taskDays,
  today,
  orgId,
  onTasksChanged,
  selectedEventId,
  onSelectEvent,
  onPickSlot,
  onOpenDay,
}: {
  cells: CalendarGridCell[];
  githubItems: CalendarOverlayItem[];
  taskDays: Map<string, TaskOnCalendar[]>;
  today: string;
  orgId: string;
  onTasksChanged: () => void;
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  /**
   * A day was pressed. `hour` is null when the press carried no position —
   * a keyboard activation — and the composer asks for a time instead.
   */
  onPickSlot: (day: string, hour: number | null) => void;
  onOpenDay: (day: string) => void;
}) {
  return (
    <div className="tc-timed-wrap">
      <div
        className={`tc-timed${cells.length === 1 ? " is-day" : ""}`}
        style={{
          ["--tc-cols" as string]: String(cells.length),
          ["--tc-hours" as string]: String(CALENDAR_GRID_HOURS.length),
        }}
      >
        <div className="tc-timed-head">
          <span className="tc-timed-corner" />
          {cells.map((cell) => (
            <button
              key={`h-${cell.day}`}
              type="button"
              className={cell.isToday ? "today" : undefined}
              onClick={() => onOpenDay(cell.day)}
            >
              <span>{WEEKDAYS[new Date(`${cell.day}T12:00:00`).getDay()]}</span>
              <strong>{dayNum(cell.day)}</strong>
            </button>
          ))}
        </div>
        <div className="tc-timed-allday">
          <span className="tc-allday-label">All day</span>
          {cells.map((cell) => {
            const allDay = cell.items.filter(isAllDayCalendarEvent);
            const github = overlayItemsForDay(githubItems, cell.day);
            return (
              <div key={`a-${cell.day}`} className="tc-allday">
                {allDay.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className="tc-allday-chip"
                    onClick={() => onSelectEvent(event.id)}
                  >
                    {event.title}
                  </button>
                ))}
                {github.map((item) => (
                  <a
                    key={item.id}
                    className="tc-github-chip"
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub · {item.title}
                  </a>
                ))}
                {/* Tasks have a due date but no hour, so the all-day row is the
                    only honest place for them — the same place Google puts them. */}
                <DayTasks
                  tasks={taskDays.get(cell.day) ?? []}
                  today={today}
                  orgId={orgId}
                  onChanged={onTasksChanged}
                />
              </div>
            );
          })}
        </div>
        <div className="tc-timed-body">
          <div className="tc-timed-gutter" aria-hidden="true">
            {CALENDAR_GRID_HOURS.map((hour) => (
              <span key={hour}>{formatHourLabel(hour)}</span>
            ))}
          </div>
          {cells.map((cell) => {
            const blocks = layoutTimedEventsForDay(cell.items);
            return (
              <div key={`c-${cell.day}`} className="tc-timed-col">
                {/*
                  One target for the whole day, not one per hour.

                  Fifteen hours across seven days is 105 buttons, and every one
                  of them was in the tab order and the accessibility tree — so
                  reaching anything below the grid by keyboard meant pressing
                  Tab a hundred times through empty slots, and a screen reader
                  read out "Add at 7 AM on Monday, Add at 8 AM on Monday…" for
                  a minute before saying anything useful.

                  The hour is where you pressed, which is what a calendar has
                  always meant by clicking a time. The lines are painted rather
                  than built out of elements, so it looks identical.

                  A keyboard press has no position — `detail` is 0 — so it
                  gives the day and leaves the time to the composer, which asks
                  for one anyway. Nothing is lost: the composer below is a
                  standing form, not something these buttons opened.
                */}
                <button
                  type="button"
                  className="tc-timed-surface"
                  aria-label={`Add on ${cell.day}`}
                  onClick={(event) => {
                    if (event.detail === 0) {
                      onPickSlot(cell.day, null);
                      return;
                    }
                    const box = event.currentTarget.getBoundingClientRect();
                    const share = box.height > 0 ? (event.clientY - box.top) / box.height : 0;
                    const index = Math.min(
                      CALENDAR_GRID_HOURS.length - 1,
                      Math.max(0, Math.floor(share * CALENDAR_GRID_HOURS.length)),
                    );
                    onPickSlot(cell.day, CALENDAR_GRID_HOURS[index]!);
                  }}
                />
                {blocks.map((block) => (
                  <button
                    key={block.event.id}
                    type="button"
                    className={[
                      "tc-timed-block",
                      selectedEventId === block.event.id ? "selected" : "",
                      block.event.source === "tba" ? "tba" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      top: `${block.topPct}%`,
                      height: `${block.heightPct}%`,
                      left: `calc(${(block.col / block.cols) * 100}% + 2px)`,
                      width: `calc(${100 / block.cols}% - 4px)`,
                      borderColor: block.event.subteamColor ?? "var(--accent)",
                    }}
                    onClick={() => onSelectEvent(block.event.id)}
                  >
                    <b>{fmtTime(block.event.startsAt)}</b>
                    <span>{block.event.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
