"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui";
import type { CommandSnapshot } from "../../lib/command/types";
import {
  customEventProblemCopy,
  validateCustomEvent,
} from "../../lib/events/custom-event";
import type { EventOption } from "./command-model";

export type CustomEventSubmission = {
  name: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  stateProv: string | null;
};

/**
 * The form for an event The Blue Alliance does not carry.
 *
 * Offseasons — GRITS, and the equivalent in every other region — are real
 * competitions where teams scout for real. Only a name and a year are required,
 * because standing in a venue on the first morning that is often all anyone can
 * say for certain. Dates and city are there for the schedule to look right
 * afterwards, not as a gate on getting started.
 */
function AddEventForm({
  busy,
  year,
  message,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  year: number;
  message?: string;
  onSubmit: (draft: CustomEventSubmission) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState("");

  const draft = { name, year, startDate: startDate || null, endDate: endDate || null };
  const problems = validateCustomEvent(draft);
  // An untouched form is not a form full of mistakes. Errors appear once there
  // is something to be wrong about.
  const showProblems = name.trim().length > 0 || startDate !== "" || endDate !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problems.length) return;
    onSubmit({
      name: name.trim(),
      year,
      startDate: startDate || null,
      endDate: endDate || null,
      city: city.trim() || null,
      stateProv: stateProv.trim() || null,
    });
  }

  return (
    <form className="edc-add-event" onSubmit={submit}>
      <label>
        Event name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="GRITS"
          autoFocus
          required
        />
      </label>
      <div className="edc-add-event-row">
        <label>
          Starts
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          Ends
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <div className="edc-add-event-row">
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
        </label>
        <label>
          State or region
          <input
            value={stateProv}
            onChange={(e) => setStateProv(e.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>
      {showProblems && problems.length ? (
        <ul className="edc-add-event-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{customEventProblemCopy(problem)}</li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <p className="edc-add-event-problems" role="alert">
          {message}
        </p>
      ) : null}
      <p className="edc-muted">
        Scouting, the schedule and strategy all treat this exactly like a district
        event. Match results will not arrive from The Blue Alliance, so anything
        you want from this event is what your team scouts.
      </p>
      <div className="edc-add-event-actions">
        <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || problems.length > 0}>
          {busy ? "Adding…" : "Add and make active"}
        </Button>
      </div>
    </form>
  );
}

/** Whether the event list is on its way, failed to arrive, or arrived (possibly empty). */
export type EventListState = "loading" | "failed" | "ready";

/** The line in the list when there is nothing to pick yet; never "none" while still loading. */
export function emptyEventListCopy(state: EventListState, year: number, searching: boolean): string {
  if (state === "loading") return "Loading this season's events…";
  if (state === "failed") return "We couldn't load the event list.";
  if (searching) return "No event matches that search. Try part of the name or the city, or add it below.";
  return `No ${year} events are listed yet. The Blue Alliance posts the season's events around kickoff. Going to an offseason event or one that isn't listed? Add it below.`;
}

export function CommandEventPicker({
  open,
  query,
  events,
  eventsState = "ready",
  onRetry,
  busy,
  snap,
  year,
  onClose,
  onQuery,
  onSelect,
  onClear,
  onCreate,
  message,
}: {
  open: boolean;
  query: string;
  events: EventOption[];
  eventsState?: EventListState;
  onRetry?: () => void;
  busy: boolean;
  snap: CommandSnapshot | null;
  year: number;
  onClose: () => void;
  onQuery: (value: string) => void;
  onSelect: (eventKey: string) => void;
  onClear: () => void;
  onCreate: (draft: CustomEventSubmission) => void;
  message?: string;
}) {
  const [adding, setAdding] = useState(false);
  // Escape closes it, like every other dialog (it only closed from Cancel or ×).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Rendered into <body>: inside the hub panel a transformed ancestor made "position: fixed"
  // relative to the panel, so the dim backdrop covered only part of the screen.
  const dialog = (
    <div className="edc-modal" role="dialog" aria-modal="true" aria-labelledby="edc-event-title">
      <div>
        <header>
          <h2 id="edc-event-title">{adding ? "Add an event" : "Which event are you going to?"}</h2>
          <Button variant="icon" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </header>
        {adding ? (
          <AddEventForm
            busy={busy}
            year={year}
            message={message}
            onSubmit={onCreate}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <>
            <p className="edc-muted">
              Matches, scouting and My Day all follow the event you pick. Not seeing yours? Offseason
              events aren&rsquo;t listed, so add it below.
            </p>
            <input
              className="edc-search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search event name, key, or city"
              aria-label="Search events"
            />
            <ul className="edc-event-list">
              {events.length ? (
                // The team's current event first, marked, so the dialog opens on where they are.
                [...events]
                  .sort((a, b) => Number(b.eventKey === snap?.eventKey) - Number(a.eventKey === snap?.eventKey))
                  .map((event) => (
                  <li key={event.eventKey}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-current={event.eventKey === snap?.eventKey ? "true" : undefined}
                      onClick={() => onSelect(event.eventKey)}
                    >
                      <strong>
                        {event.eventKey === snap?.eventKey ? <span aria-hidden="true">✓ </span> : null}
                        {event.name}
                        {event.eventKey === snap?.eventKey ? <em className="edc-event-own">Current</em> : null}
                        {/* Worth marking: a team-made event will never receive
                            Blue Alliance results, and the label is the only
                            place that difference is visible. */}
                        {event.custom ? <em className="edc-event-own">Your event</em> : null}
                      </strong>
                      {/* Where and when, which is how people tell events apart; the raw key
                          ("2026gacmp") meant nothing to them. */}
                      <span>{eventWhereWhen(event) || event.eventKey}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="edc-empty-events" role={eventsState === "loading" ? "status" : undefined} aria-busy={eventsState === "loading" || undefined}>
                  {emptyEventListCopy(eventsState, year, query.trim().length > 0)}
                  {eventsState === "failed" && onRetry ? (
                    <>
                      {" "}
                      <button type="button" className="text-button" onClick={onRetry}>
                        Try again
                      </button>
                    </>
                  ) : null}
                </li>
              )}
            </ul>
            {message ? (
              <p className="edc-add-event-problems" role="alert">
                {message}
              </p>
            ) : null}
            <div className="edc-event-footer">
              <Button variant="secondary" type="button" onClick={() => setAdding(true)}>
                Add an event that isn’t listed
              </Button>
              {/* A quiet link: as a button the same size as the others, it read as a normal choice. */}
              {snap?.eventKey ? (
                <button type="button" className="text-button" disabled={busy} onClick={onClear}>
                  Stop following this event
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

/** "Macon, GA · Mar 19–22", from whatever the event row has. */
function eventWhereWhen(event: EventOption): string {
  const place = [event.city, event.stateProv].filter(Boolean).join(", ");
  const day = (value: string | null) => {
    if (!value) return null;
    const date = new Date(`${value.slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const start = day(event.startDate);
  const end = day(event.endDate);
  const when = start && end && start !== end ? `${start}–${end}` : start;
  return [place, when].filter(Boolean).join(" · ");
}
