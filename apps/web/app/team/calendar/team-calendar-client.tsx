"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { TeamHubRelated } from "../../../components/team-hub-related";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import {
  googleCalendarSubscribeUrl,
  toWebcalUrl,
} from "../../../lib/calendar-ics";
import {
  CALENDAR_TEAM_RELATED_INCLUDE,
  calendarNextActions,
  calendarOpsRelatedLinks,
  monthEventCountLabel,
  monthEventPeek,
} from "../../../lib/calendar/calendar-related";
import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../../lib/offline";
import {
  DUTY_KIND_LABELS,
  DUTY_KINDS,
  defaultDutyTitle,
  dutyWorkflowLinks,
  groupDutiesByDay,
  type DutyKind,
} from "../../../lib/duty-roster-shared";
import {
  buildMonthCells,
  buildWeekCells,
  defaultQuickAddStartsAt,
  eventWorkflowLinks,
  filterEventsBySubteam,
  formatAnchorLabel,
  groupEventsByDay,
  RSVP_LABELS,
  shiftAnchor,
  SUBTEAM_COLOR_SUGGESTIONS,
  SUBTEAM_EVENT_KIND_LABELS,
  SUBTEAM_EVENT_KINDS,
  upcomingEvents,
  type CalendarFeedScope,
  type CalendarEvent,
  type CalendarViewMode,
  type DutyOnCalendar,
  type RsvpResponse,
  type Subteam,
  type SubteamCalendarView,
  type SubteamEventKind,
  type SubteamMemberLite,
  type TravelLegOnCalendar,
} from "../../../lib/subteam-calendar";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<SubteamCalendarView, { status: "ready" }>;
type Tab = "calendar" | "subteams" | "duties" | "trip" | "sync";
type DutyScope = "team" | "mine";

function withOrg(path: string, orgId: string) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayNum(day: string): string {
  return String(Number(day.slice(8, 10)));
}

function formatDayLabelLocal(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function CalendarNextActions({ actions }: { actions: ReturnType<typeof calendarNextActions> }) {
  if (actions.length === 0) return null;
  return (
    <section className="tc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>From your real subteams and events — empty until those exist. Never DEMO events.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventCard({
  event,
  orgId,
  busy,
  canDelete,
  onDelete,
  onRsvp,
}: {
  event: CalendarEvent;
  orgId: string;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onRsvp: (response: RsvpResponse | null) => void;
}) {
  const accent = event.subteamColor ?? "var(--app-accent)";
  const links = eventWorkflowLinks(event, orgId);
  const going = event.myRsvp === "going";

  return (
    <article className="tc-event" style={{ ["--tc-accent" as string]: accent }}>
      <div className="tc-event-top">
        <strong>{event.title}</strong>
        {canDelete ? (
          <button type="button" className="tc-text-btn" disabled={busy} onClick={onDelete}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="tc-event-meta">
        <span className="tc-chip">{SUBTEAM_EVENT_KIND_LABELS[event.kind]}</span>
        <span>
          {fmtWhen(event.startsAt)}
          {event.endsAt ? ` → ${fmtWhen(event.endsAt)}` : ""}
        </span>
        {event.subteamName ? <span style={{ color: accent }}>{event.subteamName}</span> : <span>Whole team</span>}
        {event.location ? <span>{event.location}</span> : null}
      </div>
      {event.notes ? <p className="tc-muted">{event.notes}</p> : null}

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

      {links.length > 0 ? (
        <div className="tc-links">
          {links.map((link) => (
            <a key={link.href + link.label} href={link.href}>
              {link.label} →
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function QuickAddForm({
  orgId,
  subteams,
  filterSubteamId,
  initialStartsAt,
  busy,
  run,
  onDone,
}: {
  orgId: string;
  subteams: Subteam[];
  filterSubteamId: string | null;
  initialStartsAt: string;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean>;
  onDone?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SubteamEventKind>("practice");
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [subteamId, setSubteamId] = useState(filterSubteamId ?? "");
  const [createAttendance, setCreateAttendance] = useState(true);

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
        if (!title.trim() || !startsAt) return;
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
        <h2>Quick add</h2>
        <p className="tc-muted">One title + time — defaults to practice with attendance roll-call.</p>
      </div>
      <div className="tc-quick-grid">
        <input
          value={title}
          disabled={busy}
          required
          placeholder="e.g. Tuesday drive practice"
          aria-label="Event title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <select value={kind} disabled={busy} aria-label="Kind" onChange={(e) => setKind(e.target.value as SubteamEventKind)}>
          {SUBTEAM_EVENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {SUBTEAM_EVENT_KIND_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={startsAt}
          disabled={busy}
          required
          aria-label="Starts"
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <select value={subteamId} disabled={busy} aria-label="Subteam" onChange={(e) => setSubteamId(e.target.value)}>
          <option value="">Whole team</option>
          {subteams.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </div>
      <label className="tc-check">
        <input
          type="checkbox"
          checked={createAttendance}
          disabled={busy}
          onChange={(e) => setCreateAttendance(e.target.checked)}
        />
        <span>Create attendance roll-call</span>
      </label>
      <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsAt}>
        Add event
      </button>
    </form>
  );
}

function CreateEventForm({
  orgId,
  subteams,
  attendanceEvents,
  practiceSessions,
  filterSubteamId,
  busy,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  attendanceEvents: ReadyView["attendanceEvents"];
  practiceSessions: ReadyView["practiceSessions"];
  filterSubteamId: string | null;
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

  useEffect(() => {
    setSubteamId(filterSubteamId ?? "");
  }, [filterSubteamId]);

  useEffect(() => {
    if (kind === "practice" || kind === "build") setCreateAttendance(true);
  }, [kind]);

  return (
    <form
      className="tc-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !startsAt) return;
        void run(
          {
            action: "create_event",
            orgId,
            title: title.trim(),
            kind,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location,
            notes,
            subteamId: subteamId || null,
            createAttendance: createAttendance && !attendanceEventId,
            attendanceEventId: attendanceEventId || null,
            driverSessionId: driverSessionId || null,
          },
          "create-event",
        ).then((ok) => {
          if (ok) {
            setTitle("");
            setNotes("");
            setLocation("");
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
      {!attendanceEventId ? (
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
      <button type="submit" className="app-button secondary" disabled={busy || !title.trim() || !startsAt}>
        Add detailed event
      </button>
    </form>
  );
}

function SubteamsPanel({
  orgId,
  subteams,
  members,
  busyKey,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  members: SubteamMemberLite[];
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const busy = busyKey != null;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SUBTEAM_COLOR_SUGGESTIONS[0]);
  const [description, setDescription] = useState("");

  const toggleMemberSubteam = (member: SubteamMemberLite, subteamId: string) => {
    const next = member.subteamIds.includes(subteamId)
      ? member.subteamIds.filter((id) => id !== subteamId)
      : [...member.subteamIds, subteamId];
    void run({ action: "set_member_subteams", orgId, userId: member.userId, subteamIds: next }, `m:${member.userId}`);
  };

  return (
    <div className="tc-layout">
      <section className="tc-panel">
        <form
          className="tc-sub-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run({ action: "create_subteam", orgId, name: name.trim(), color, description }, "create-subteam").then(
              (ok) => {
                if (ok) {
                  setName("");
                  setDescription("");
                }
              },
            );
          }}
        >
          <h2>Create a subteam</h2>
          <p className="tc-muted">
            Mechanical, Electrical, Programming, Business, Drive — whatever your team uses. Nothing is seeded for you.
          </p>
          <label className="tc-field">
            <span>Name</span>
            <input value={name} disabled={busy} placeholder="Programming" required onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="tc-color-row" role="group" aria-label="Color">
            {SUBTEAM_COLOR_SUGGESTIONS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={color === swatch ? "tc-color active" : "tc-color"}
                style={{ background: swatch }}
                aria-label={swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
          <label className="tc-field">
            <span>Description</span>
            <input value={description} disabled={busy} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit" className="app-button" disabled={busy || !name.trim()}>
            Create subteam
          </button>
        </form>

        {subteams.length > 0 ? (
          <ul className="tc-sub-list">
            {subteams.map((st) => (
              <li key={st.id}>
                <span className="tc-sub-name">
                  <i className="tc-dot" style={{ background: st.color }} />
                  {st.name}
                  <span className="tc-muted">{st.memberCount} members</span>
                </span>
                <button
                  type="button"
                  className="tc-text-btn"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete subteam “${st.name}”? Calendar events for it are removed; people stay on the team.`)) {
                      void run({ action: "delete_subteam", orgId, id: st.id }, `st:${st.id}`);
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tc-muted">No subteams yet — create the first one above.</p>
        )}
      </section>

      <section className="tc-panel">
        <h2>Assign members</h2>
        {subteams.length === 0 ? (
          <p className="tc-muted">Create a subteam before assigning people.</p>
        ) : members.length === 0 ? (
          <p className="tc-muted">No members on this team yet.</p>
        ) : (
          <table className="tc-roster">
            <thead>
              <tr>
                <th>Member</th>
                <th>Subteams</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <div>{member.name || member.email || "Member"}</div>
                    <div className="tc-muted">{member.role}</div>
                  </td>
                  <td>
                    {subteams.map((st) => {
                      const on = member.subteamIds.includes(st.id);
                      return (
                        <button
                          key={st.id}
                          type="button"
                          className={on ? "tc-toggle on" : "tc-toggle"}
                          style={on ? { background: st.color } : undefined}
                          disabled={busyKey === `m:${member.userId}`}
                          onClick={() => toggleMemberSubteam(member, st.id)}
                        >
                          {st.name}
                        </button>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DutyCard({
  duty,
  orgId,
  highlighted,
  canDelete,
  busy,
  onDelete,
}: {
  duty: DutyOnCalendar;
  orgId: string;
  highlighted: boolean;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const accent = duty.subteamColor ?? "var(--app-accent)";
  const links = dutyWorkflowLinks(duty.kind, orgId);

  return (
    <article
      id={`duty-${duty.id}`}
      className={highlighted ? "tc-event tc-duty highlighted" : "tc-event tc-duty"}
      style={{ ["--tc-accent" as string]: accent }}
    >
      <div className="tc-event-top">
        <strong>{duty.title}</strong>
        {canDelete ? (
          <button type="button" className="tc-text-btn" disabled={busy} onClick={onDelete}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="tc-event-meta">
        <span className="tc-chip">{DUTY_KIND_LABELS[duty.kind]}</span>
        <span>
          {fmtWhen(duty.startsAt)}
          {duty.endsAt ? ` → ${fmtWhen(duty.endsAt)}` : ""}
        </span>
        {duty.assignedUserName ? (
          <span>{duty.mine ? "You" : duty.assignedUserName}</span>
        ) : (
          <span className="tc-muted">Unassigned</span>
        )}
        {duty.subteamName ? <span style={{ color: accent }}>{duty.subteamName}</span> : null}
      </div>
      {duty.notes ? <p className="tc-muted">{duty.notes}</p> : null}
      {links.length > 0 ? (
        <div className="tc-links">
          {links.map((link) => (
            <a key={link.href + link.label} href={link.href}>
              {link.label} →
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AssignDutyForm({
  orgId,
  subteams,
  members,
  initialStartsAt,
  busy,
  onSubmit,
}: {
  orgId: string;
  subteams: Subteam[];
  members: SubteamMemberLite[];
  initialStartsAt: string;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<DutyKind>("scouting");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [endsAt, setEndsAt] = useState("");
  const [subteamId, setSubteamId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setStartsAt(initialStartsAt);
  }, [initialStartsAt]);

  return (
    <form
      className="tc-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          action: "create_duty",
          orgId,
          kind,
          title: title.trim() || defaultDutyTitle(kind),
          startsAt,
          endsAt: endsAt || null,
          subteamId: subteamId || null,
          assignedUserId: assignedUserId || null,
          notes,
          linkCalendar: true,
        }).then((ok) => {
          if (!ok) return;
          setTitle("");
          setEndsAt("");
          setNotes("");
          setAssignedUserId("");
        });
      }}
    >
      <h3>Assign duty</h3>
      <p className="tc-muted">Scouting, pit, drive team, or outreach — empty until you assign someone.</p>
      <label>
        Kind
        <select value={kind} onChange={(event) => setKind(event.target.value as DutyKind)}>
          {DUTY_KINDS.map((value) => (
            <option key={value} value={value}>
              {DUTY_KIND_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={defaultDutyTitle(kind)}
          maxLength={200}
        />
      </label>
      <label>
        Starts
        <input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
      </label>
      <label>
        Ends
        <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
      </label>
      <label>
        Member
        <select value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)}>
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name || member.email || member.userId}
            </option>
          ))}
        </select>
      </label>
      <label>
        Subteam
        <select value={subteamId} onChange={(event) => setSubteamId(event.target.value)}>
          <option value="">Whole team</option>
          {subteams.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} />
      </label>
      <button type="submit" className="app-button" disabled={busy}>
        Assign to calendar
      </button>
    </form>
  );
}


function TripPanel({
  orgId,
  travelLegs,
  mySubteamIds,
}: {
  orgId: string;
  travelLegs: TravelLegOnCalendar[];
  mySubteamIds: string[];
}) {
  const scoped = useMemo(() => {
    return travelLegs.filter((leg) => leg.subteamId == null || mySubteamIds.includes(leg.subteamId));
  }, [travelLegs, mySubteamIds]);
  const byTrip = useMemo(() => {
    const map = new Map<string, { title: string; items: typeof scoped }>();
    for (const leg of scoped) {
      const bucket = map.get(leg.tripId) ?? { title: leg.tripTitle, items: [] };
      bucket.items.push(leg);
      map.set(leg.tripId, bucket);
    }
    return [...map.entries()];
  }, [scoped]);
  return (
    <div className="tc-layout">
      <section className="tc-panel tc-main">
        {scoped.length === 0 ? (
          <div className="app-card tc-empty tc-guide">
            <strong>No trip times yet</strong>
            <p className="app-muted">Mentors add leave / hotel / venue / return in Event Logistics.</p>
            <a className="app-button" href={withOrg("/logistics", orgId)}>
              Open logistics
            </a>
          </div>
        ) : (
          byTrip.map(([tripId, bucket]) => (
            <div key={tripId} className="tc-day">
              <h3>{bucket.title}</h3>
              {bucket.items.map((leg) => (
                <article key={leg.id} className="tc-event tc-travel">
                  <header>
                    <strong>{leg.title}</strong>
                    <span className="tc-chip">{leg.kind.replaceAll("_", " ")}</span>
                  </header>
                  <div className="tc-meta">
                    <span>{fmtWhen(leg.startsAt)}</span>
                    {leg.meetingPoint ? <span>Meet: {leg.meetingPoint}</span> : null}
                    {leg.location ? <span>{leg.location}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function DutiesPanel({
  orgId,
  duties,
  subteams,
  members,
  mySubteamIds,
  canManage,
  busyKey,
  highlightId,
  initialStartsAt,
  onMutate,
}: {
  orgId: string;
  duties: DutyOnCalendar[];
  subteams: Subteam[];
  members: SubteamMemberLite[];
  mySubteamIds: string[];
  canManage: boolean;
  busyKey: string | null;
  highlightId: string | null;
  initialStartsAt: string;
  onMutate: (body: Record<string, unknown>, key: string) => Promise<boolean>;
}) {
  const [scope, setScope] = useState<DutyScope>("team");
  // Personal scope uses `mine` plus subteam-only slots for the member's groups.
  const scoped = useMemo(() => {
    if (scope === "team") return duties;
    return duties.filter(
      (duty) =>
        duty.mine ||
        (duty.assignedUserId == null && duty.subteamId != null && mySubteamIds.includes(duty.subteamId)),
    );
  }, [duties, scope, mySubteamIds]);
  const days = useMemo(() => groupDutiesByDay(scoped), [scoped]);
  const busy = busyKey != null;

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`duty-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, scoped]);

  return (
    <div className="tc-layout">
      <section className="tc-panel tc-main">
        <div className="tc-mode" role="group" aria-label="Duty scope">
          <button type="button" className={scope === "team" ? "active" : undefined} onClick={() => setScope("team")}>
            Team roster
          </button>
          <button type="button" className={scope === "mine" ? "active" : undefined} onClick={() => setScope("mine")}>
            My duties
          </button>
        </div>

        {scoped.length === 0 ? (
          <div className="app-card tc-empty tc-guide">
            <strong>{scope === "mine" ? "No duties assigned to you yet" : "No duties on the roster yet"}</strong>
            <p className="app-muted">
              Assign scouting shifts, pit blocks, drive team, or outreach to a member or subteam. Nothing is seeded —
              the roster stays empty until you assign.
            </p>
          </div>
        ) : (
          days.map((bucket) => (
            <div key={bucket.day} className="tc-day">
              <h3>{bucket.day}</h3>
              {bucket.items.map((duty) => (
                <DutyCard
                  key={duty.id}
                  duty={duty}
                  orgId={orgId}
                  highlighted={duty.id === highlightId}
                  canDelete={canManage}
                  busy={busy}
                  onDelete={() => {
                    if (confirm(`Remove duty “${duty.title}”?`)) {
                      void onMutate({ action: "delete_duty", orgId, id: duty.id }, `duty-del:${duty.id}`);
                    }
                  }}
                />
              ))}
            </div>
          ))
        )}
      </section>

      <aside className="tc-panel">
        <AssignDutyForm
          orgId={orgId}
          subteams={subteams}
          members={members}
          initialStartsAt={initialStartsAt}
          busy={busy}
          onSubmit={(body) => onMutate(body, "duty-create")}
        />
        <div className="tc-related">
          <a href={withOrg("/scouting", orgId)}>Scout forms</a>
          <a href={withOrg("/pit", orgId)}>Pit Command</a>
          <a href={withOrg("/command", orgId)}>Event Day</a>
          <a href={withOrg("/impact", orgId)}>Outreach / Impact</a>
        </div>
      </aside>
    </div>
  );
}

function CalendarSyncPanel({
  orgId,
  subteams,
  feedToken,
  scope,
  subteamId,
  onScopeChange,
  onSubteamChange,
  busyKey,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  feedToken: string | null;
  scope: CalendarFeedScope;
  subteamId: string;
  onScopeChange: (scope: CalendarFeedScope) => void;
  onSubteamChange: (subteamId: string) => void;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const busy = busyKey === "cal-feed";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const httpsUrl = feedToken ? `${origin}/api/calendar/feed/${feedToken}` : "";
  const webcalUrl = httpsUrl ? toWebcalUrl(httpsUrl) : "";
  const googleUrl = webcalUrl ? googleCalendarSubscribeUrl(webcalUrl) : "";

  const feedBody = () => ({
    orgId,
    scope,
    subteamId: scope === "subteam" ? subteamId || null : null,
  });

  const copy = async () => {
    if (!httpsUrl) return;
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* selectable input fallback */
    }
  };

  const downloadHref = (() => {
    const params = new URLSearchParams({ orgId, format: "ics", scope });
    if (scope === "subteam" && subteamId) params.set("subteamId", subteamId);
    return `/api/team/calendar?${params.toString()}`;
  })();

  return (
    <section className="soft-panel tc-sync" aria-labelledby="tc-sync-title">
      <div className="tc-sync-head">
        <div>
          <h2 id="tc-sync-title">Add to Google / Apple Calendar</h2>
          <p className="app-muted">
            Subscribe once and Vantage practices, build nights, and season milestones stay updated in your phone
            calendar. The link is a secret — only people with it can see the feed.
          </p>
        </div>
      </div>

      <div className="tc-sync-grid">
        <label>
          Feed
          <select
            value={scope}
            disabled={busy}
            onChange={(event) => onScopeChange(event.target.value as CalendarFeedScope)}
          >
            <option value="personal">Personal (my subteams + whole team)</option>
            <option value="org">Whole team (every subteam)</option>
            <option value="subteam">One subteam</option>
          </select>
        </label>
        {scope === "subteam" ? (
          <label>
            Subteam
            <select
              value={subteamId}
              disabled={busy}
              onChange={(event) => onSubteamChange(event.target.value)}
            >
              <option value="">Select subteam…</option>
              {subteams.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {feedToken && httpsUrl ? (
        <>
          <label className="tc-sync-url">
            Subscribe URL
            <div className="tc-sync-url-row">
              <input readOnly value={httpsUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar feed URL" />
              <button type="button" className="app-button secondary" disabled={busy} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </label>
          <div className="tc-sync-actions">
            <a className="app-button" href={webcalUrl}>
              Add to Apple Calendar
            </a>
            <a className="app-button secondary" href={googleUrl} target="_blank" rel="noreferrer">
              Add to Google Calendar
            </a>
            <a className="app-button secondary" href={downloadHref}>
              Download .ics
            </a>
          </div>
          <div className="tc-sync-actions">
            <button
              type="button"
              className="tc-text-btn"
              disabled={busy || (scope === "subteam" && !subteamId)}
              onClick={() => {
                if (
                  confirm(
                    "Generate a new link? Your current subscription will stop updating until you re-add the new one.",
                  )
                ) {
                  void run({ action: "rotate_calendar_feed", ...feedBody() }, "cal-feed");
                }
              }}
            >
              Regenerate link
            </button>
            <button
              type="button"
              className="tc-text-btn danger"
              disabled={busy}
              onClick={() => {
                if (confirm("Turn off this calendar subscription? The link will stop working.")) {
                  void run({ action: "disable_calendar_feed", ...feedBody() }, "cal-feed");
                }
              }}
            >
              Turn off
            </button>
          </div>
        </>
      ) : (
        <div className="tc-sync-actions">
          <button
            type="button"
            className="app-button"
            disabled={busy || (scope === "subteam" && !subteamId)}
            onClick={() => void run({ action: "ensure_calendar_feed", ...feedBody() }, "cal-feed")}
          >
            Create my subscribe link
          </button>
          <a className="app-button secondary" href={downloadHref}>
            Download .ics once
          </a>
        </div>
      )}

      <aside className="tc-sync-note" aria-label="Timezone notes">
        <strong>Timezone</strong>
        <p className="app-muted">
          Timed events are stored in UTC and shown in your calendar app&apos;s local zone. Season milestones are
          all-day dates (no timezone shift), so Kickoff stays on the calendar day you set. Vantage does not invent a
          team timezone.
        </p>
      </aside>
    </section>
  );
}

export default function TeamCalendarClient({ embedded = false }: { embedded?: boolean } = {}) {
  const online = useOnline();
  const [view, setView] = useState<SubteamCalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");
  const [filterSubteamId, setFilterSubteamId] = useState<string | null>(null);
  const [mode, setMode] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [quickDay, setQuickDay] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [syncScope, setSyncScope] = useState<CalendarFeedScope>("personal");
  const [syncSubteamId, setSyncSubteamId] = useState<string | null>(null);
  const [highlightDutyId, setHighlightDutyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const dutyId = params.get("dutyId");
    if (dutyId) {
      setHighlightDutyId(dutyId);
      setTab("duties");
    }
    if (params.get("tab") === "trip") setTab("trip");
    const cached = await getFeatureSnapshot<SubteamCalendarView>("team-calendar", orgId);
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const query = new URLSearchParams();
      if (orgId) query.set("orgId", orgId);
      query.set("scope", syncScope);
      if (syncScope === "subteam" && syncSubteamId) query.set("subteamId", syncSubteamId);
      const response = await fetch(`/api/team/calendar?${query.toString()}`);
      const data = (await response.json()) as SubteamCalendarView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the team calendar.");
        if (!cached) setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = data.context.orgId || orgId;
      if (cacheOrg) await putFeatureSnapshot("team-calendar", cacheOrg, data);
    } catch {
      if (!cached) setFetchFailed(true);
    }
  }, [syncScope, syncSubteamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (!navigator.onLine) {
        setError("You're offline — calendar edits will save when you reconnect.");
        return false;
      }
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/team/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — changes were not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const runDuty = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/duties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Duty action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — duty was not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const ready = view?.status === "ready" ? view : null;
  const filtered = useMemo(
    () => (ready ? filterEventsBySubteam(ready.events, filterSubteamId) : []),
    [ready, filterSubteamId],
  );
  const days = useMemo(() => groupEventsByDay(filtered), [filtered]);
  const listDays = useMemo(() => {
    if (!quickDay) return days;
    const focused = days.filter((bucket) => bucket.day === quickDay);
    const rest = days.filter((bucket) => bucket.day !== quickDay);
    if (focused.length === 0) {
      return [
        {
          day: quickDay,
          label: formatDayLabelLocal(quickDay),
          items: [] as CalendarEvent[],
        },
        ...rest,
      ];
    }
    return [...focused, ...rest];
  }, [days, quickDay]);
  const upcoming = useMemo(() => upcomingEvents(filtered, new Date(), 6), [filtered]);
  const weekCells = useMemo(() => buildWeekCells(anchor, filtered), [anchor, filtered]);
  const monthCells = useMemo(() => buildMonthCells(anchor, filtered), [anchor, filtered]);
  const selectedEvent = useMemo(
    () => (selectedEventId ? filtered.find((event) => event.id === selectedEventId) ?? null : null),
    [filtered, selectedEventId],
  );
  const quickStartsAt = useMemo(() => defaultQuickAddStartsAt(quickDay), [quickDay]);

  if (fetchFailed || !view) {
    return (
      <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <>
            <header className="app-page-header">
              <div>
                <span className="breadcrumbs">Team / Calendar</span>
                <h1>Calendar</h1>
                <p>Subteam calendars for practices, build sessions, and deadlines — never DEMO events.</p>
              </div>
            </header>
            <TeamOpsNav active="calendar" />
          </>
        ) : null}
        <OfflineBanner feature="Calendar" fromCache={Boolean(view) && fromCache} cachedAt={cachedAt} />
        <div className="app-card tc-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load the team calendar</strong>
              <p className="app-muted">
                {error ||
                  (!online
                    ? "No cached calendar on this device yet. Open this page once while online."
                    : "Check your connection and try again.")}
              </p>
              <div className="tc-guide-actions">
                <button type="button" className="app-button secondary" onClick={() => void load()}>
                  Retry
                </button>
                <a className="app-button secondary" href="/workspace">
                  Workspace
                </a>
              </div>
            </>
          ) : (
            <p className="app-muted">Loading team calendar…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupActions = calendarNextActions({
      orgId: view.context.orgId,
      subteamCount: 0,
      eventCount: 0,
      canManage: false,
    });
    return (
      <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <>
            <header className="app-page-header">
              <div>
                <span className="breadcrumbs">Team / Calendar</span>
                <h1>Calendar</h1>
                <p>Subteam calendars for practices, build sessions, and deadlines.</p>
              </div>
            </header>
            <TeamOpsNav active="calendar" />
          </>
        ) : null}
        <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card tc-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <div className="tc-guide-actions">
            <a className="app-button" href="/workspace">
              Choose workspace
            </a>
          </div>
        </div>
        <CalendarNextActions actions={setupActions} />
      </main>
    );
  }

  const orgId = view.context.orgId!;
  const canManage = view.context.canManage;
  const teamLabel = view.context.teamNumber ? `Team ${view.context.teamNumber}` : view.context.orgName;
  const busy = busyKey != null;
  const hasSubteams = view.subteams.length > 0;
  const hasEvents = view.events.length > 0;
  const nextActions = calendarNextActions({
    orgId,
    subteamCount: view.subteams.length,
    eventCount: view.events.length,
    canManage,
  });
  const opsLinks = calendarOpsRelatedLinks(orgId);

  const setRsvp = (eventId: string, response: RsvpResponse | null) => {
    void run({ action: "set_rsvp", orgId, id: eventId, response }, `rsvp:${eventId}`);
  };

  const renderEventCard = (event: CalendarEvent) => (
    <EventCard
      key={event.id}
      event={event}
      orgId={orgId}
      busy={busy}
      canDelete={canManage}
      onDelete={() => {
        if (confirm(`Remove “${event.title}” from the calendar?`)) {
          void run({ action: "delete_event", orgId, id: event.id }, `del:${event.id}`);
        }
      }}
      onRsvp={(response) => setRsvp(event.id, response)}
    />
  );

  return (
    <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <>
          <header className="app-page-header">
            <div>
              <span className="breadcrumbs">Team / Calendar</span>
              <h1>Calendar</h1>
              <p>
                {teamLabel} — practices, subteams, and “I’m going.” Season milestones stay on{" "}
                <a href={withOrg("/calendar", orgId)}>Season Calendar</a>. Nothing is seeded as DEMO.
              </p>
            </div>
          </header>
          <TeamOpsNav orgId={orgId} active="calendar" />
          <TeamHubRelated orgId={orgId} active="calendar" include={[...CALENDAR_TEAM_RELATED_INCLUDE]} />
          {opsLinks.length > 0 ? (
            <nav className="product-hub-related tc-ops-related" aria-label="Related ops tools">
              {opsLinks.map((link) => (
                <a key={link.id} className="app-button secondary" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          ) : null}
        </>
      ) : null}
      <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? <p className="tc-error">{error}</p> : null}

      <CalendarNextActions actions={nextActions} />

      <div className="tc-tabs" role="tablist" aria-label="Calendar sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "calendar"}
          className={tab === "calendar" ? "active" : ""}
          onClick={() => setTab("calendar")}
        >
          Calendar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "duties"}
          className={tab === "duties" ? "active" : ""}
          onClick={() => setTab("duties")}
        >
          Duties{(view.duties?.length ?? 0) > 0 ? ` (${view.duties!.length})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "trip"}
          className={tab === "trip" ? "active" : ""}
          onClick={() => setTab("trip")}
        >
          My trip{(view.travelLegs?.length ?? 0) > 0 ? ` (${view.travelLegs!.length})` : ""}
        </button>
        {canManage ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "subteams"}
            className={tab === "subteams" ? "active" : ""}
            onClick={() => setTab("subteams")}
          >
            Subteams
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sync"}
          className={tab === "sync" ? "active" : ""}
          onClick={() => setTab("sync")}
        >
          Sync
        </button>
      </div>

      {tab === "duties" ? (
        <DutiesPanel
          orgId={orgId}
          duties={view.duties ?? []}
          subteams={view.subteams}
          members={view.members}
          mySubteamIds={view.mySubteamIds}
          canManage={canManage}
          busyKey={busyKey}
          highlightId={highlightDutyId}
          initialStartsAt={quickStartsAt}
          onMutate={runDuty}
        />
      ) : tab === "trip" ? (
        <TripPanel orgId={orgId} travelLegs={view.travelLegs ?? []} mySubteamIds={view.mySubteamIds} />
      ) : tab === "subteams" && canManage ? (
        <SubteamsPanel orgId={orgId} subteams={view.subteams} members={view.members} busyKey={busyKey} run={run} />
      ) : tab === "sync" ? (
        <CalendarSyncPanel
          orgId={orgId}
          subteams={view.subteams}
          feedToken={view.calendarFeed?.token ?? null}
          scope={syncScope}
          subteamId={syncSubteamId ?? ""}
          onScopeChange={(next) => {
            setSyncScope(next);
            if (next !== "subteam") setSyncSubteamId(null);
          }}
          onSubteamChange={(next) => setSyncSubteamId(next || null)}
          busyKey={busyKey}
          run={run}
        />
      ) : (
        <>
          {!hasSubteams ? (
            <div className="app-card tc-empty tc-guide">
              <strong>Create your first subteam</strong>
              <p className="app-muted">
                Calendars stay empty until groups exist — Mechanical, Programming, Business, Drive. No DEMO
                subteams are seeded.
              </p>
              <div className="tc-guide-actions">
                {canManage ? (
                  <button type="button" className="app-button" onClick={() => setTab("subteams")}>
                    Create first subteam
                  </button>
                ) : (
                  <span className="tc-muted">Ask an owner or admin to create the first subteam.</span>
                )}
                <a className="app-button secondary" href={withOrg("/practice", orgId)}>
                  Open Practice
                </a>
                <a className="app-button secondary" href={withOrg("/messages", orgId)}>
                  Messages
                </a>
              </div>
            </div>
          ) : null}

          {hasSubteams && !hasEvents ? (
            <div className="app-card tc-empty tc-guide">
              <strong>Schedule your first practice</strong>
              <p className="app-muted">
                Quick-add a Tuesday shop night, or open Practice / Attendance after the real session. Nothing
                is invented for you.
              </p>
              <div className="tc-guide-actions">
                <button
                  type="button"
                  className="app-button"
                  onClick={() => {
                    setMode("week");
                    setQuickDay(null);
                    document.getElementById("tc-quick-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Quick-add practice
                </button>
                <a className="app-button secondary" href={withOrg("/practice", orgId)}>
                  Practice
                </a>
                <a className="app-button secondary" href={withOrg("/attendance", orgId)}>
                  Attendance
                </a>
                <a className="app-button secondary" href={withOrg("/logistics", orgId)}>
                  Logistics
                </a>
              </div>
            </div>
          ) : null}

          <div className="tc-filters" role="group" aria-label="Filter by subteam">
            <button
              type="button"
              className={filterSubteamId == null ? "tc-filter active" : "tc-filter"}
              style={filterSubteamId == null ? { background: "var(--app-accent)" } : undefined}
              onClick={() => setFilterSubteamId(null)}
            >
              Combined team
            </button>
            {view.subteams.map((st) => (
              <button
                key={st.id}
                type="button"
                className={filterSubteamId === st.id ? "tc-filter active" : "tc-filter"}
                style={filterSubteamId === st.id ? { background: st.color } : undefined}
                onClick={() => setFilterSubteamId(st.id)}
              >
                <i className="tc-dot" style={{ background: filterSubteamId === st.id ? "#fff" : st.color }} />
                {st.name}
              </button>
            ))}
            {view.mySubteamIds.length > 0 && filterSubteamId == null ? (
              <span className="tc-muted">
                You’re on {view.mySubteamIds.length} subteam{view.mySubteamIds.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className="tc-toolbar">
            <div className="tc-mode" role="group" aria-label="Calendar view">
              {(["week", "month", "agenda"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mode === value ? "active" : undefined}
                  onClick={() => setMode(value)}
                >
                  {value === "agenda" ? "List" : value === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
            {mode !== "agenda" ? (
              <div className="tc-nav-range">
                <button type="button" className="tc-icon-btn" aria-label="Previous" onClick={() => setAnchor((d) => shiftAnchor(d, mode, -1))}>
                  ‹
                </button>
                <strong>{formatAnchorLabel(anchor, mode)}</strong>
                <button type="button" className="tc-icon-btn" aria-label="Next" onClick={() => setAnchor((d) => shiftAnchor(d, mode, 1))}>
                  ›
                </button>
                <button type="button" className="tc-text-link" onClick={() => setAnchor(new Date())}>
                  Today
                </button>
              </div>
            ) : quickDay ? (
              <div className="tc-nav-range">
                <strong>List · {formatDayLabelLocal(quickDay)}</strong>
                <button type="button" className="tc-text-link" onClick={() => setQuickDay(null)}>
                  Clear day focus
                </button>
              </div>
            ) : (
              <p className="tc-muted tc-list-hint">Chronological list by local day — same events as Month / Week.</p>
            )}
          </div>

          <div className="tc-layout">
            <section className="tc-panel tc-main">
              {mode === "agenda" ? (
                listDays.length === 0 ? (
                  <div className="tc-empty tc-list-empty">
                    <strong>No events in this list</strong>
                    <p className="tc-muted">
                      Switch filters, Quick-add a practice, or open Practice / Attendance after a real session.
                    </p>
                    <div className="tc-guide-actions">
                      <button
                        type="button"
                        className="app-button"
                        onClick={() =>
                          document.getElementById("tc-quick-add")?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }
                      >
                        Quick-add
                      </button>
                      <a className="app-button secondary" href={withOrg("/practice", orgId)}>
                        Practice
                      </a>
                    </div>
                  </div>
                ) : (
                  listDays.map((bucket) => (
                    <div
                      key={bucket.day}
                      className={["tc-day", quickDay === bucket.day ? "focused" : ""].filter(Boolean).join(" ")}
                      id={quickDay === bucket.day ? "tc-list-focus" : undefined}
                    >
                      <h3>
                        {bucket.label}
                        <span className="tc-day-count">
                          {bucket.items.length === 0
                            ? " · none scheduled"
                            : ` · ${bucket.items.length} event${bucket.items.length === 1 ? "" : "s"}`}
                        </span>
                      </h3>
                      {bucket.items.length === 0 ? (
                        <p className="tc-muted">Tap Quick-add to schedule this day — the calendar does not invent DEMO events.</p>
                      ) : (
                        bucket.items.map((event) => renderEventCard(event))
                      )}
                    </div>
                  ))
                )
              ) : null}

              {mode === "week" ? (
                <div className="tc-week">
                  {weekCells.map((cell) => (
                    <button
                      key={cell.day}
                      type="button"
                      className={["tc-week-day", cell.isToday ? "today" : "", quickDay === cell.day ? "picked" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setQuickDay(cell.day);
                        setSelectedEventId(null);
                      }}
                    >
                      <header>
                        <span>{WEEKDAYS[new Date(`${cell.day}T12:00:00`).getDay()]}</span>
                        <strong>{dayNum(cell.day)}</strong>
                      </header>
                      <ul>
                        {cell.items.slice(0, 4).map((event) => (
                          <li
                            key={event.id}
                            style={{ borderColor: event.subteamColor ?? "var(--app-accent)" }}
                            onClick={(click) => {
                              click.stopPropagation();
                              setSelectedEventId(event.id);
                            }}
                          >
                            <b>{fmtTime(event.startsAt)}</b>
                            <span>{event.title}</span>
                          </li>
                        ))}
                        {cell.items.length > 4 ? <li className="more">+{cell.items.length - 4} more</li> : null}
                      </ul>
                      <span className="tc-add-hint">Tap to quick-add</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mode === "month" ? (
                <div className="tc-month">
                  <div className="tc-month-head">
                    {WEEKDAYS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  <div className="tc-month-grid">
                    {monthCells.map((cell) => {
                      const countLabel = monthEventCountLabel(cell.items.length);
                      const { peeks, overflow } = monthEventPeek(
                        cell.items.map((event) => event.title),
                        2,
                      );
                      return (
                        <button
                          key={cell.day}
                          type="button"
                          className={[
                            "tc-month-cell",
                            cell.inMonth ? "" : "out",
                            cell.isToday ? "today" : "",
                            quickDay === cell.day ? "picked" : "",
                            cell.items.length > 0 ? "has-events" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-label={`${formatDayLabelLocal(cell.day)}${
                            cell.items.length > 0
                              ? `, ${cell.items.length} event${cell.items.length === 1 ? "" : "s"}`
                              : ", no events"
                          }`}
                          onClick={() => {
                            setQuickDay(cell.day);
                            setAnchor(new Date(`${cell.day}T12:00:00`));
                            if (cell.items.length > 0) {
                              setSelectedEventId(cell.items[0]!.id);
                              setMode("agenda");
                              requestAnimationFrame(() => {
                                document.getElementById("tc-list-focus")?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              });
                            } else {
                              setSelectedEventId(null);
                              document
                                .getElementById("tc-quick-add")
                                ?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                        >
                          <header className="tc-month-cell-head">
                            <strong>{dayNum(cell.day)}</strong>
                            {countLabel ? <span className="tc-month-count">{countLabel}</span> : null}
                          </header>
                          <ul>
                            {peeks.map((title, index) => {
                              const event = cell.items[index]!;
                              return (
                                <li
                                  key={event.id}
                                  style={{ background: event.subteamColor ?? "var(--app-accent)" }}
                                  title={title}
                                >
                                  {title}
                                </li>
                              );
                            })}
                            {overflow > 0 ? <li className="more">+{overflow}</li> : null}
                          </ul>
                          {cell.items.length === 0 && cell.inMonth ? (
                            <span className="tc-month-empty">Add</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedEvent && mode !== "agenda" ? (
                <div className="tc-selected">{renderEventCard(selectedEvent)}</div>
              ) : null}
            </section>

            <aside className="tc-panel">
              <div id="tc-quick-add">
                <QuickAddForm
                  orgId={orgId}
                  subteams={view.subteams}
                  filterSubteamId={filterSubteamId}
                  initialStartsAt={quickStartsAt}
                  busy={busy}
                  run={run}
                  onDone={() => setQuickDay(null)}
                />
              </div>

              <h2>Coming up</h2>
              {upcoming.length === 0 ? (
                <p className="tc-muted">Nothing upcoming in this filter.</p>
              ) : (
                <ul className="tc-upcoming">
                  {upcoming.map((event) => (
                    <li key={event.id}>
                      <button type="button" className="tc-upcoming-btn" onClick={() => setSelectedEventId(event.id)}>
                        <strong>{event.title}</strong>
                        <span>
                          {fmtWhen(event.startsAt)}
                          {event.subteamName ? ` · ${event.subteamName}` : " · Whole team"}
                          {event.myRsvp === "going" ? " · going" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <details className="tc-details">
                <summary>More event details</summary>
                <CreateEventForm
                  orgId={orgId}
                  subteams={view.subteams}
                  attendanceEvents={view.attendanceEvents}
                  practiceSessions={view.practiceSessions}
                  filterSubteamId={filterSubteamId}
                  busy={busy}
                  run={run}
                />
              </details>

              <div className="tc-related">
                <a href={withOrg("/practice", orgId)}>Practice</a>
                <a href={withOrg("/attendance", orgId)}>Attendance</a>
                <a href={withOrg("/logistics", orgId)}>Logistics</a>
                <a href={withOrg("/messages", orgId)}>Messages</a>
                <a href={withOrg("/calendar", orgId)}>Season milestones</a>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
