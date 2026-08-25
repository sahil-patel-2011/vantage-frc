"use client";

// Public, read-only parent view (no session). One-way by design: it shows the
// team's upcoming schedule and the linked student's OWN RSVP — no chat, no
// roster, no contact info, no other student's name. Unknown token -> an honest
// "link not valid" state; unreachable database -> "try again later".
import { useEffect, useMemo, useState } from "react";
import type { ParentViewEvent, ParentViewState } from "../../../lib/parent-comms/view";

const RSVP_LABEL: Record<string, string> = {
  going: "Your student: going",
  maybe: "Your student: maybe",
  no: "Your student: not going",
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function whenLabel(event: ParentViewEvent): string {
  const start = timeLabel(event.startsAt);
  const end = event.endsAt ? timeLabel(event.endsAt) : "";
  return end ? `${start}–${end}` : start;
}

export default function ParentViewClient({ token }: { token: string }) {
  const [state, setState] = useState<ParentViewState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetch(`/api/parent-view/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        const data = (await response.json()) as ParentViewState | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailed(true);
          return;
        }
        setState(data);
      })
      .catch(() => setFailed(true));
  }, [token]);

  const groups = useMemo(() => {
    if (state?.status !== "ready") return [];
    const byDay: Array<{ day: string; events: ParentViewEvent[] }> = [];
    for (const event of state.events) {
      const day = dayLabel(event.startsAt);
      const last = byDay[byDay.length - 1];
      if (last && last.day === day) last.events.push(event);
      else byDay.push({ day, events: [event] });
    }
    return byDay;
  }, [state]);

  if (notFound) {
    return (
      <main className="parent-view">
        <div className="parent-view-inner">
          <section className="parent-view-card parent-view-state">
            <h2>This link is not valid</h2>
            <p>It may have been turned off by the team. Ask a team mentor for a fresh link.</p>
          </section>
        </div>
      </main>
    );
  }

  if (failed || state?.status === "setup_required") {
    return (
      <main className="parent-view">
        <div className="parent-view-inner">
          <section className="parent-view-card parent-view-state">
            <h2>Schedule unavailable</h2>
            <p>
              {state?.status === "setup_required"
                ? state.message
                : "This page could not load right now. Please try again later."}
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="parent-view">
        <div className="parent-view-inner" aria-busy="true">
          <section className="parent-view-card parent-view-state">
            <p>Loading the team schedule…</p>
          </section>
        </div>
      </main>
    );
  }

  const teamLabel =
    state.teamNumber != null ? `${state.orgName} (Team ${state.teamNumber})` : state.orgName;

  return (
    <main className="parent-view">
      <div className="parent-view-inner">
        <header className="parent-view-header">
          <span className="eyebrow">Parent view</span>
          <h1>{teamLabel}</h1>
          <p>
            Upcoming team schedule for the next 30 days
            {state.studentLabel ? ` — ${state.studentLabel}` : ""}.
          </p>
        </header>

        {state.status === "empty" ? (
          <section className="parent-view-card parent-view-state">
            <h2>Nothing scheduled</h2>
            <p>{state.message}</p>
          </section>
        ) : (
          groups.map((group) => (
            <section key={group.day} className="parent-view-card">
              <h2 className="parent-view-day">{group.day}</h2>
              {group.events.map((event) => (
                <div key={event.id} className="parent-view-event">
                  <span className="when">{whenLabel(event)}</span>
                  <span className="what">{event.title}</span>
                  {event.location ? <span className="where">@ {event.location}</span> : null}
                  {event.studentRsvp ? (
                    <span className="parent-view-rsvp">{RSVP_LABEL[event.studentRsvp]}</span>
                  ) : null}
                </div>
              ))}
            </section>
          ))
        )}

        <p className="parent-view-note">
          This read-only page was shared with you by the team. Times are shown in your device's
          time zone. It does not accept replies or RSVPs.
        </p>
      </div>
    </main>
  );
}
