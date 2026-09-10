"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui";
import {
  DUTY_KIND_LABELS,
  DUTY_KINDS,
  defaultDutyTitle,
  groupDutiesByDay,
  type DutyKind,
} from "../../../lib/duty-roster-shared";
import {
  SUBTEAM_COLOR_SUGGESTIONS,
  type DutyOnCalendar,
  type Subteam,
  type SubteamMemberLite,
  type TravelLegOnCalendar,
} from "../../../lib/subteam-calendar";
import {
  fmtWhen,
  withOrg,
  type ActionBody,
  type DutyScope,
} from "./calendar-model";

export function SubteamsPanel({
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
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Create subteam
          </Button>
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

export function DutyCard({
  duty,
  highlighted,
  canDelete,
  busy,
  onDelete,
}: {
  duty: DutyOnCalendar;
  highlighted: boolean;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const accent = duty.subteamColor ?? "var(--accent)";

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
    </article>
  );
}

export function AssignDutyForm({
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
      <Button variant="primary" type="submit" disabled={busy}>
        Assign to calendar
      </Button>
    </form>
  );
}

export function TripPanel({
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
            <Button as="a" variant="primary" href={withOrg("/logistics", orgId)}>
              Open logistics
            </Button>
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

export function DutiesPanel({
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
      </aside>
    </div>
  );
}
