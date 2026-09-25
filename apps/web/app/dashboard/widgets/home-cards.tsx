"use client";

import { useEffect, useState } from "react";
import { DEV_SETUP_DONE_KEY } from "../../../lib/dev-setup/track";

function localTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function asItems(data: Record<string, unknown>, key = "items"): Array<Record<string, unknown>> {
  const raw = data[key];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

/**
 * Your own day: the robot you scout next, today's events and your duties. The team's next
 * match is the Next match card's and the "now" line's; this card repeated it a third time.
 */
export function MyDayLive({ data }: { data: Record<string, unknown> }) {
  const events = asItems(data, "events");
  const duties = asItems(data, "duties");
  const scout = data.scoutDuty as { teamKey?: unknown; matchLabel?: unknown; station?: unknown } | null | undefined;
  const scoutLine =
    scout && typeof scout.teamKey === "string"
      ? [scout.teamKey.replace(/^frc/, ""), scout.matchLabel, scout.station].filter(Boolean).join(" · ")
      : null;
  const nothing = !scoutLine && events.length === 0 && duties.length === 0;
  return (
    <div>
      {scoutLine ? (
        <p>
          You scout <strong>{scoutLine}</strong>
        </p>
      ) : null}
      {events.length ? (
        <ul className="dash-checklist">
          {events.map((event) => (
            <li key={String(event.startsAt) + String(event.title)}>
              <span>{String(event.title)}</span>
              <small className="dash-notif-preview">{localTime(String(event.startsAt))}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {nothing ? <p className="app-muted">Nothing on your list today.</p> : null}
      {duties.length ? (
        <ul className="dash-checklist">
          {duties.map((duty) => (
            <li key={String(duty.startsAt) + String(duty.title)}>
              <span>On duty: {String(duty.title)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LearnProgressLive({ data }: { data: Record<string, unknown> }) {
  const [codeDone, setCodeDone] = useState(0);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DEV_SETUP_DONE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      setCodeDone(Array.isArray(parsed) ? parsed.length : 0);
    } catch {
      setCodeDone(0);
    }
  }, []);
  const cadCompleted = Number(data.cadCompleted ?? 0);
  const cadTotal = Number(data.cadTotal ?? 0);
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>
          {cadCompleted}
          {cadTotal > 0 ? `/${cadTotal}` : ""}
        </strong>
        <span>CAD lessons done</span>
      </div>
      <div>
        <strong>{codeDone || "—"}</strong>
        <span>laptop setup ticks</span>
      </div>
    </div>
  );
}

export function FilesRecentLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((file) => (
        <li key={String(file.id)}>
          <span>{String(file.name)}</span>
        </li>
      ))}
    </ul>
  );
}

export function TeamChatLive({ data }: { data: Record<string, unknown> }) {
  const unread = Number(data.unread ?? 0);
  const channels = asItems(data, "channels");
  return (
    <div>
      <div className="dash-metric-grid">
        <div>
          <strong>{unread}</strong>
          <span>unread</span>
        </div>
      </div>
      {channels.length ? (
        <ul className="dash-checklist">
          {channels.map((channel) => (
            <li key={String(channel.title)}>
              <span>{String(channel.title)}</span>
              <small className="dash-notif-preview">{String(channel.unread)} unread</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HoursThisMonthLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>{String(data.hours ?? "—")}</strong>
        {/* The card is titled "Hours this month"; the caption says the unit, not the title again. */}
        <span>hours</span>
      </div>
    </div>
  );
}
