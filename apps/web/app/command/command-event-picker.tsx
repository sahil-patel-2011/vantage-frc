"use client";

import { useState, type FormEvent } from "react";
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
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  year: number;
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

export function CommandEventPicker({
  open,
  query,
  events,
  busy,
  snap,
  teamDataHref,
  year,
  onClose,
  onQuery,
  onSelect,
  onClear,
  onCreate,
}: {
  open: boolean;
  query: string;
  events: EventOption[];
  busy: boolean;
  snap: CommandSnapshot | null;
  teamDataHref: string;
  year: number;
  onClose: () => void;
  onQuery: (value: string) => void;
  onSelect: (eventKey: string) => void;
  onClear: () => void;
  onCreate: (draft: CustomEventSubmission) => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!open) return null;
  return (
    <div className="edc-modal" role="dialog" aria-modal="true" aria-labelledby="edc-event-title">
      <div>
        <header>
          <h2 id="edc-event-title">{adding ? "Add an event" : "Set active event"}</h2>
          <Button variant="icon" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </header>
        {adding ? (
          <AddEventForm
            busy={busy}
            year={year}
            onSubmit={onCreate}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <>
            <p className="edc-muted">
              Only owners and admins can set the event. Not seeing yours? Offseason
              events are not in The Blue Alliance — add it below.
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
                events.map((event) => (
                  <li key={event.eventKey}>
                    <button type="button" disabled={busy} onClick={() => onSelect(event.eventKey)}>
                      <strong>
                        {event.name}
                        {/* Worth marking: a team-made event will never receive
                            Blue Alliance results, and the label is the only
                            place that difference is visible. */}
                        {event.custom ? <em className="edc-event-own">Your event</em> : null}
                      </strong>
                      <span>
                        {event.eventKey}
                        {event.city ? ` · ${event.city}` : ""}
                        {event.stateProv ? `, ${event.stateProv}` : ""}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="edc-empty-events">
                  No events in cache for this year.{" "}
                  <a href={teamDataHref}>Open Team → Data to load events</a>, or add
                  your own below.
                </li>
              )}
            </ul>
            <div className="edc-event-footer">
              <Button variant="secondary" type="button" onClick={() => setAdding(true)}>
                Add an event that isn’t listed
              </Button>
              {snap?.eventKey ? (
                <Button variant="secondary" type="button" disabled={busy} onClick={onClear}>
                  Clear active event
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
