"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui";
import {
  EMPTY_REPEAT_DRAFT,
  OccurrenceScopeChoice,
  RepeatControl,
  browserTimeZone,
  repeatDraftToRule,
  type OccurrenceScope,
  type RepeatDraft,
} from "./repeat-control";
import {
  defaultQuickAddStartsAt,
  RSVP_LABELS,
  SUBTEAM_EVENT_KIND_LABELS,
  SUBTEAM_EVENT_KINDS,
  type RsvpResponse,
  type Subteam,
  type SubteamEventKind,
} from "../../../lib/subteam-calendar";
import { toLocalInputValue } from "../../../lib/calendar-ai/pick";
import {
  fmtWhen,
  isSeriesEvent,
  type ActionBody,
  type EventPrefill,
  type ReadyView,
  type RecurringEvent,
} from "./calendar-model";

/**
 * Edit one meeting. For a series the save step is the standard three-way choice,
 * because "this Tuesday we start at 5" and "we start at 5 from now on" are
 * different edits and guessing between them loses a team's schedule.
 */
export function OccurrenceEditor({
  event,
  busy,
  onSave,
  onCancel,
}: {
  event: RecurringEvent;
  busy: boolean;
  onSave: (patch: Record<string, unknown>, scope: OccurrenceScope) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(event.startsAt));
  const [endsAt, setEndsAt] = useState(() => toLocalInputValue(event.endsAt));
  const [location, setLocation] = useState(event.location ?? "");
  const repeats = isSeriesEvent(event);

  const buildPatch = (): Record<string, unknown> | null => {
    const trimmed = title.trim();
    if (!trimmed || !startsAt) return null;
    const startMs = new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return null;
    const endMs = endsAt ? new Date(endsAt).getTime() : null;
    if (endMs != null && (Number.isNaN(endMs) || endMs < startMs)) return null;
    return {
      title: trimmed,
      startsAt: new Date(startMs).toISOString(),
      endsAt: endMs == null ? null : new Date(endMs).toISOString(),
      location,
    };
  };

  const submit = (scope: OccurrenceScope) => {
    const patch = buildPatch();
    if (!patch) return;
    onSave(patch, scope);
  };

  return (
    <div className="tc-occurrence-edit">
      <div className="tc-form-grid">
        <label className="tc-field wide">
          <span>Title</span>
          <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="tc-field">
          <span>Starts</span>
          <input
            type="datetime-local"
            value={startsAt}
            disabled={busy}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="tc-field">
          <span>Ends</span>
          <input
            type="datetime-local"
            value={endsAt}
            disabled={busy}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </label>
        <label className="tc-field wide">
          <span>Location</span>
          <input value={location} disabled={busy} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </div>
      {repeats ? (
        <OccurrenceScopeChoice
          title="Save this change to…"
          actionLabel="Save"
          busy={busy}
          onPick={submit}
          onCancel={onCancel}
        />
      ) : (
        <div className="tc-occurrence-actions">
          <Button variant="secondary" type="button" disabled={busy || !title.trim() || !startsAt} onClick={() => submit("this")}>
            Save
          </Button>
          <button type="button" className="tc-text-btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function EventCard({
  event,
  busy,
  canDelete,
  onDelete,
  onRsvp,
  scopePrompt,
  onScopePick,
  onCancelScope,
  canEdit,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  event: RecurringEvent;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onRsvp: (response: RsvpResponse | null) => void;
  /** Set while this card is asking how far a removal should reach. */
  scopePrompt?: boolean;
  onScopePick?: (scope: OccurrenceScope) => void;
  onCancelScope?: () => void;
  canEdit?: boolean;
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (patch: Record<string, unknown>, scope: OccurrenceScope) => void;
}) {
  const accent = event.subteamColor ?? "var(--accent)";
  const going = event.myRsvp === "going";
  const repeats = isSeriesEvent(event);

  return (
    <article className="tc-event" style={{ ["--tc-accent" as string]: accent }}>
      <div className="tc-event-top">
        <strong>{event.title}</strong>
        <span className="tc-event-tools">
          {canEdit && onStartEdit ? (
            <button
              type="button"
              className="tc-text-btn"
              disabled={busy}
              onClick={editing ? onCancelEdit : onStartEdit}
            >
              {editing ? "Close" : "Edit"}
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="tc-text-btn" disabled={busy} onClick={onDelete}>
              Remove
            </button>
          ) : null}
        </span>
      </div>
      {editing && onSaveEdit && onCancelEdit ? (
        <OccurrenceEditor event={event} busy={busy} onSave={onSaveEdit} onCancel={onCancelEdit} />
      ) : null}
      {repeats && event.recurrenceSummary ? (
        <p className="tc-repeat-badge">
          <span aria-hidden="true">↻</span> {event.recurrenceSummary}
        </p>
      ) : null}
      {scopePrompt && onScopePick && onCancelScope ? (
        <OccurrenceScopeChoice
          title={`Remove “${event.title}” from the calendar?`}
          actionLabel="Remove"
          destructive
          busy={busy}
          onPick={onScopePick}
          onCancel={onCancelScope}
        />
      ) : null}
      <div className="tc-event-meta">
        <span className="tc-chip">{event.source === "tba" ? "Match" : SUBTEAM_EVENT_KIND_LABELS[event.kind]}</span>
        <span>
          {fmtWhen(event.startsAt)}
          {event.endsAt ? ` → ${fmtWhen(event.endsAt)}` : ""}
        </span>
        {event.source === "tba" ? (
          <span style={{ color: accent }}>{event.bumper === "red" ? "RED" : "BLUE"}</span>
        ) : event.subteamName ? (
          <span style={{ color: accent }}>{event.subteamName}</span>
        ) : (
          <span>Whole team</span>
        )}
        {event.location ? <span>{event.location}</span> : null}
      </div>
      {event.notes ? <p className="tc-muted">{event.notes}</p> : null}

      {event.source === "tba" ? null : (
      <div className="tc-rsvp" role="group" aria-label="RSVP">
        <button
          type="button"
          className={going ? "tc-rsvp-btn active" : "tc-rsvp-btn"}
          disabled={busy}
          onClick={() => onRsvp(going ? null : "going")}
        >
          {going ? "You're going" : "I'm going"}
          {event.rsvpGoing > 0 ? <span>{event.rsvpGoing}</span> : null}
        </button>
        <button
          type="button"
          className={event.myRsvp === "maybe" ? "tc-rsvp-btn soft active" : "tc-rsvp-btn soft"}
          disabled={busy}
          onClick={() => onRsvp(event.myRsvp === "maybe" ? null : "maybe")}
        >
          {RSVP_LABELS.maybe}
        </button>
        <button
          type="button"
          className={event.myRsvp === "no" ? "tc-rsvp-btn soft active" : "tc-rsvp-btn soft"}
          disabled={busy}
          onClick={() => onRsvp(event.myRsvp === "no" ? null : "no")}
        >
          No
        </button>
      </div>
      )}
    </article>
  );
}

export function QuickAddForm({
  orgId,
  subteams,
  filterSubteamId,
  initialStartsAt,
  busy,
  run,
  addTask,
  onDone,
}: {
  orgId: string;
  subteams: Subteam[];
  filterSubteamId: string | null;
  initialStartsAt: string;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean>;
  /** Creates a team task through /api/todos. Resolves false if it failed. */
  addTask: (input: { title: string; dueOn: string; subteamId: string | null }) => Promise<boolean>;
  onDone?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SubteamEventKind>("practice");
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [subteamId, setSubteamId] = useState(filterSubteamId ?? "");
  const [createAttendance, setCreateAttendance] = useState(true);
  // Event or task, the way Google Calendar splits them. A task is a due date
  // with no hour, so switching hides the time and the roll-call rather than
  // pretending a deadline happens at 6pm.
  const [entry, setEntry] = useState<"event" | "task">("event");
  const [savingTask, setSavingTask] = useState(false);
  const dueOn = startsAt.slice(0, 10);

  useEffect(() => {
    setStartsAt(initialStartsAt);
  }, [initialStartsAt]);

  useEffect(() => {
    setSubteamId(filterSubteamId ?? "");
  }, [filterSubteamId]);

  useEffect(() => {
    setCreateAttendance(kind === "practice" || kind === "build");
  }, [kind]);

  return (
    <form
      className="tc-quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;

        if (entry === "task") {
          if (!dueOn) return;
          setSavingTask(true);
          void addTask({ title: title.trim(), dueOn, subteamId: subteamId || null })
            .then((ok) => {
              if (ok) {
                setTitle("");
                onDone?.();
              }
            })
            .finally(() => setSavingTask(false));
          return;
        }

        if (!startsAt) return;
        void run(
          {
            action: "create_event",
            orgId,
            title: title.trim(),
            kind,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: null,
            location: "",
            notes: "",
            subteamId: subteamId || null,
            createAttendance,
            attendanceEventId: null,
            driverSessionId: null,
          },
          "quick-add",
        ).then((ok) => {
          if (ok) {
            setTitle("");
            onDone?.();
          }
        });
      }}
    >
      <div className="tc-quick-head">
        <h2>{entry === "task" ? "Add task" : "Add event"}</h2>
        <div className="tc-entry-switch" role="group" aria-label="What to add">
          {(["event", "task"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={entry === value ? "active" : undefined}
              aria-pressed={entry === value}
              onClick={() => setEntry(value)}
            >
              {value === "event" ? "Event" : "Task"}
            </button>
          ))}
        </div>
      </div>
      <div className="tc-quick-grid">
        <input
          value={title}
          disabled={busy || savingTask}
          required
          placeholder={entry === "task" ? "e.g. Order the swerve modules" : "e.g. Tuesday drive practice"}
          aria-label={entry === "task" ? "Task title" : "Event title"}
          onChange={(e) => setTitle(e.target.value)}
        />
        {entry === "event" ? (
          <select value={kind} disabled={busy} aria-label="Kind" onChange={(e) => setKind(e.target.value as SubteamEventKind)}>
            {SUBTEAM_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {SUBTEAM_EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        ) : null}
        {entry === "event" ? (
          <input
            type="datetime-local"
            value={startsAt}
            disabled={busy}
            required
            aria-label="Starts"
            onChange={(e) => setStartsAt(e.target.value)}
          />
        ) : (
          // A task is due on a day, not at an hour. Asking for a time here would
          // invent precision the task does not have.
          <input
            type="date"
            value={dueOn}
            disabled={busy || savingTask}
            required
            aria-label="Due"
            onChange={(e) => setStartsAt(e.target.value ? `${e.target.value}T09:00` : "")}
          />
        )}
        <select
          value={subteamId}
          disabled={busy || savingTask}
          aria-label="Subteam"
          onChange={(e) => setSubteamId(e.target.value)}
        >
          <option value="">Whole team</option>
          {subteams.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </div>
      {entry === "event" ? (
        <label className="tc-check">
          <input
            type="checkbox"
            checked={createAttendance}
            disabled={busy}
            onChange={(e) => setCreateAttendance(e.target.checked)}
          />
          <span>Create attendance roll-call</span>
        </label>
      ) : (
        <p className="tc-muted">
          Lands on the team task list and on this calendar, on the day it is due. Assign it on{" "}
          <a href="/todos">Tasks</a>.
        </p>
      )}
      <Button variant="primary" type="submit" disabled={ busy || savingTask || !title.trim() || (entry === "task" ? !dueOn : !startsAt) }>
        {savingTask ? "Adding…" : entry === "task" ? "Add task" : "Add event"}
      </Button>
    </form>
  );
}

export function CreateEventForm({
  orgId,
  subteams,
  attendanceEvents,
  practiceSessions,
  filterSubteamId,
  prefill,
  busy,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  attendanceEvents: ReadyView["attendanceEvents"];
  practiceSessions: ReadyView["practiceSessions"];
  filterSubteamId: string | null;
  prefill: EventPrefill | null;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SubteamEventKind>("practice");
  const [startsAt, setStartsAt] = useState(() => defaultQuickAddStartsAt());
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [subteamId, setSubteamId] = useState(filterSubteamId ?? "");
  const [createAttendance, setCreateAttendance] = useState(kind === "practice" || kind === "build");
  const [attendanceEventId, setAttendanceEventId] = useState("");
  const [driverSessionId, setDriverSessionId] = useState("");
  const [repeat, setRepeat] = useState<RepeatDraft>(EMPTY_REPEAT_DRAFT);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  // The shop's zone: a 6pm Tuesday build night must stay 6pm across the November
  // DST change, so the rule is anchored to wall-clock time here, not to UTC.
  const timeZone = useMemo(() => browserTimeZone(), []);
  const startsAtIso = useMemo(() => {
    if (!startsAt) return null;
    const ms = new Date(startsAt).getTime();
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }, [startsAt]);

  useEffect(() => {
    setSubteamId(filterSubteamId ?? "");
  }, [filterSubteamId]);

  useEffect(() => {
    if (kind === "practice" || kind === "build") setCreateAttendance(true);
  }, [kind]);

  // A suggested slot lands here as a draft, never as a saved event. The nonce is
  // what makes picking the same slot twice work: the values would be identical,
  // so without it React would skip the effect and the form would look stuck.
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title);
    setKind(prefill.kind);
    setStartsAt(prefill.startsAt);
    setEndsAt(prefill.endsAt);
    setSubteamId(prefill.subteamId ?? "");
    // A one-off suggestion is not a series; leave any repeat rule the person
    // typed alone rather than silently attaching it to a different date.
  }, [prefill]);

  return (
    <form
      className="tc-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !startsAt || !startsAtIso) return;
        const built = repeatDraftToRule(repeat, startsAtIso, timeZone);
        if (built.error) {
          setRepeatError(built.error);
          return;
        }
        setRepeatError(null);
        void run(
          {
            action: "create_event",
            orgId,
            title: title.trim(),
            kind,
            startsAt: startsAtIso,
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location,
            notes,
            subteamId: subteamId || null,
            // Attendance roll-call is a single dated row, so it only makes sense
            // for a one-off — a series would silently link every meeting to it.
            createAttendance: createAttendance && !attendanceEventId && !built.rrule,
            attendanceEventId: attendanceEventId || null,
            driverSessionId: driverSessionId || null,
            rrule: built.rrule,
            timeZone,
          },
          "create-event",
        ).then((ok) => {
          if (ok) {
            setTitle("");
            setNotes("");
            setLocation("");
            setRepeat(EMPTY_REPEAT_DRAFT);
          }
        });
      }}
    >
      <h2>Full schedule</h2>
      <p className="tc-muted">Location, notes, and links to practice or attendance.</p>
      <div className="tc-form-grid">
        <label className="tc-field wide">
          <span>Title</span>
          <input value={title} disabled={busy} required placeholder="Tuesday mech build" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="tc-field">
          <span>Kind</span>
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as SubteamEventKind)}>
            {SUBTEAM_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {SUBTEAM_EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="tc-field">
          <span>Subteam</span>
          <select value={subteamId} disabled={busy} onChange={(e) => setSubteamId(e.target.value)}>
            <option value="">Whole team</option>
            {subteams.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tc-field">
          <span>Starts</span>
          <input type="datetime-local" value={startsAt} disabled={busy} required onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="tc-field">
          <span>Ends</span>
          <input type="datetime-local" value={endsAt} disabled={busy} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label className="tc-field wide">
          <span>Location</span>
          <input value={location} disabled={busy} placeholder="Shop / Room 12" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="tc-field wide">
          <span>Notes</span>
          <textarea value={notes} disabled={busy} placeholder="Goals, packing list, or agenda" onChange={(e) => setNotes(e.target.value)} />
        </label>
        {attendanceEvents.length > 0 ? (
          <label className="tc-field wide">
            <span>Link existing attendance</span>
            <select
              value={attendanceEventId}
              disabled={busy}
              onChange={(e) => {
                setAttendanceEventId(e.target.value);
                if (e.target.value) setCreateAttendance(false);
              }}
            >
              <option value="">None</option>
              {attendanceEvents.map((ae) => (
                <option key={ae.id} value={ae.id}>
                  {ae.occurredOn} · {ae.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {practiceSessions.length > 0 ? (
          <label className="tc-field wide">
            <span>Link practice session</span>
            <select value={driverSessionId} disabled={busy} onChange={(e) => setDriverSessionId(e.target.value)}>
              <option value="">None</option>
              {practiceSessions.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.sessionDate} · {ps.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <RepeatControl
        draft={repeat}
        onChange={(next) => {
          setRepeat(next);
          setRepeatError(null);
        }}
        startsAtIso={startsAtIso}
        timeZone={timeZone}
        disabled={busy}
        idPrefix="create-event"
      />
      {repeatError ? <p className="tc-error">{repeatError}</p> : null}
      {!attendanceEventId && repeat.preset === "none" ? (
        <label className="tc-check">
          <input
            type="checkbox"
            checked={createAttendance}
            disabled={busy}
            onChange={(e) => setCreateAttendance(e.target.checked)}
          />
          <span>Also create an attendance roll-call for this date</span>
        </label>
      ) : null}
      <Button variant="secondary" type="submit" disabled={busy || !title.trim() || !startsAt}>
        {repeat.preset === "none" ? "Add detailed event" : "Add repeating event"}
      </Button>
    </form>
  );
}
