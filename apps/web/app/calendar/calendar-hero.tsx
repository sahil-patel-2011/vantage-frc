/**
 * The three questions the season calendar is opened with, in one row.
 *
 *   What is next?          — the milestone, and how far away it is.
 *   How much time is left? — sessions and hours before the next competition.
 *   What about this week?  — today to the end of the week the grid is drawing.
 *
 * They are separate answers on purpose. "Next milestone" is eleven weeks out
 * in October and says nothing about Thursday; "this week" says nothing about
 * whether the robot can be finished. A team needs both, and neither is a
 * summary of the other.
 *
 * Everything here is counted from entries the team actually wrote down. When
 * there is nothing to count, each block says so rather than reaching further
 * out for something to put in the space.
 *
 * Lifted out of `calendar-client.tsx` when that file reached the repo's
 * 1000-line ceiling.
 */

"use client";

import { Panel } from "../../components/ui";
import { describeShopTime, type ShopTimeLeft } from "../../lib/calendar/shop-time-left";
import { weekdayLabel, type RestOfWeek } from "../../lib/calendar/rest-of-week";
import { KIND_LABELS, meetingProvider, type Milestone } from "../../lib/season-calendar";
import type { SeasonProgress } from "../../lib/season-calendar";

export function CalendarHero({
  next,
  now,
  shopTime,
  week,
  progress,
  countdownLabel,
  daysUntil,
  fmtDate,
}: {
  next: Milestone | null;
  now: Date;
  shopTime: ShopTimeLeft | null;
  week: RestOfWeek;
  progress: SeasonProgress;
  countdownLabel: (days: number) => string;
  daysUntil: (dateISO: string, from: Date) => number;
  fmtDate: (iso: string) => string;
}) {
  return (
    <Panel className="cal-hero">
      <div className="cal-hero-next">
        <span className="cal-hero-kicker">Next milestone</span>
        {next ? (
          <>
            <span className="cal-countdown">{countdownLabel(daysUntil(next.startsOn, now))}</span>
            <div className="cal-hero-title">
              <strong>{next.title}</strong>
              <span className={`cal-chip kind-${next.kind}`}>{KIND_LABELS[next.kind]}</span>
            </div>
            <span className="app-muted">{fmtDate(next.startsOn)}</span>
            {next.meetingUrl ? (
              <a className="cal-join hero" href={next.meetingUrl} target="_blank" rel="noopener noreferrer">
                ▶ Join {meetingProvider(next.meetingUrl) ?? "meeting"}
              </a>
            ) : null}
          </>
        ) : (
          <>
            <strong>Nothing upcoming</strong>
            <span className="app-muted">Opt into a season template below, or add a milestone.</span>
          </>
        )}
      </div>
      {/*
        "How many build nights are left before the competition" is the
        question a team actually asks in January, and the grid could only
        answer it by eye — squint, count the Tuesdays, forget the week
        everyone is away for finals, be wrong in the optimistic direction.

        Counted from entries the team really put on the calendar. When there
        is nothing to count down to, or nothing scheduled to count, this is
        absent rather than zero: a team that believes it has twenty nights
        left will commit to a rebuild it cannot finish.
      */}
      {shopTime ? (
        <div className="cal-hero-shop">
          <span className="cal-hero-kicker">Shop time before {shopTime.targetTitle}</span>
          <strong>{describeShopTime(shopTime)}</strong>
          <span className="app-muted">
            {shopTime.daysUntil === 0
              ? "Today"
              : `over ${shopTime.daysUntil} ${shopTime.daysUntil === 1 ? "day" : "days"}`}
          </span>
        </div>
      ) : null}

      {/*
        "What have we got left this week?" — the most-asked calendar
        question, and the one this page answered worst. The hero said what
        the next milestone is, which in October is a competition eleven
        weeks away, and the grid showed a month. Finding out whether
        anything was on before Saturday meant reading a square at a time.

        A quiet week says so. Reaching past the end of the week to find
        something to put here would make "this week" mean whatever filled
        the box.
      */}
      <div className="cal-hero-week">
        <span className="cal-hero-kicker">Rest of this week</span>
        {week.entries.length === 0 ? (
          <span className="app-muted">Nothing else scheduled.</span>
        ) : (
          <ul>
            {week.entries.slice(0, 4).map((entry) => (
              <li key={`${entry.kind}-${entry.date}-${entry.title}`}>
                <b>{weekdayLabel(entry.date)}</b>
                {entry.timeLabel ? <span className="cal-hero-week-time">{entry.timeLabel}</span> : null}
                <span className="cal-hero-week-title">{entry.title}</span>
              </li>
            ))}
            {week.entries.length > 4 ? (
              <li className="app-muted">and {week.entries.length - 4} more</li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="cal-hero-progress">
        <span className="app-muted">
          {progress.done}/{progress.total} milestones done · {progress.percent}%
        </span>
        <div className="cal-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${progress.percent}%` }} className={progress.total > 0 && progress.done === progress.total ? "done" : undefined} />
        </div>
      </div>
    </Panel>
  );
}
