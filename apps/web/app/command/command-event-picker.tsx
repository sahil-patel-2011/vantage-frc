"use client";

import { Button } from "../../components/ui";
import type { CommandSnapshot } from "../../lib/command/types";
import type { EventOption } from "./command-model";

export function CommandEventPicker({
  open,
  query,
  events,
  busy,
  snap,
  teamDataHref,
  onClose,
  onQuery,
  onSelect,
  onClear,
}: {
  open: boolean;
  query: string;
  events: EventOption[];
  busy: boolean;
  snap: CommandSnapshot | null;
  teamDataHref: string;
  onClose: () => void;
  onQuery: (value: string) => void;
  onSelect: (eventKey: string) => void;
  onClear: () => void;
}) {
  if (!open) return null;
  return (
    <div className="edc-modal" role="dialog" aria-modal="true" aria-labelledby="edc-event-title">
      <div>
        <header>
          <h2 id="edc-event-title">Set active event</h2>
          <Button variant="icon" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </header>
        <p className="edc-muted">Only owners and admins can set the event. Empty list means the event list hasn’t been saved yet.</p>
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
                  <strong>{event.name}</strong>
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
              No events in cache for this year. <a href={teamDataHref}>Open Team → Data to load events</a>
            </li>
          )}
        </ul>
        {snap?.eventKey ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={onClear}>
            Clear active event
          </Button>
        ) : null}
      </div>
    </div>
  );
}
