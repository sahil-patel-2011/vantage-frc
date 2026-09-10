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
  onPickSlot: (day: string, hour: number) => void;
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
                {CALENDAR_GRID_HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    className="tc-timed-slot"
                    aria-label={`Add at ${formatHourLabel(hour)} on ${cell.day}`}
                    onClick={() => onPickSlot(cell.day, hour)}
                  />
                ))}
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
