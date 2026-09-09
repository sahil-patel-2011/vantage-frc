"use client";

import { useState } from "react";
import type { ImpactActivity, PersonOutreachTotal } from "../../lib/impact/types";

export type Member = { userId: string; name: string };

export type ParticipantDraft = { userId: string; minutes: string; role: string };

/**
 * "Who helped" — tick the people who were there, each with their own minutes.
 *
 * Minutes prefill from the activity's duration as a convenience and stay fully
 * visible and editable, because the honest number for the student who left at
 * half-time is half. A blank minutes box means "was there, time not recorded";
 * it shows that way on the page and never counts as zero or as the full event.
 */
export function WhoHelped({
  members,
  currentUserId,
  drafts,
  defaultMinutes,
  disabled,
  onChange,
}: {
  members: Member[];
  currentUserId: string;
  drafts: ParticipantDraft[];
  defaultMinutes: string;
  disabled?: boolean;
  onChange: (next: ParticipantDraft[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const picked = new Map(drafts.map((d) => [d.userId, d]));
  const shown = members.filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()));

  const toggle = (m: Member) => {
    if (picked.has(m.userId)) onChange(drafts.filter((d) => d.userId !== m.userId));
    else onChange([...drafts, { userId: m.userId, minutes: defaultMinutes, role: "" }]);
  };
  const update = (userId: string, patch: Partial<ParticipantDraft>) =>
    onChange(drafts.map((d) => (d.userId === userId ? { ...d, ...patch } : d)));

  if (members.length === 0) {
    return <p className="app-muted">No team members yet — invite people from the Team page to credit them here.</p>;
  }

  return (
    <div className="impact-who">
      <div className="impact-who-head">
        <strong>Who helped</strong>
        <input
          value={filter}
          placeholder="Find a name"
          aria-label="Find a team member"
          onChange={(e) => setFilter(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="text-button"
          disabled={disabled || picked.has(currentUserId)}
          onClick={() => {
            const me = members.find((m) => m.userId === currentUserId);
            if (me) toggle(me);
          }}
        >
          Add me
        </button>
      </div>
      <ul className="impact-who-list">
        {shown.map((m) => {
          const d = picked.get(m.userId);
          return (
            <li key={m.userId} className={d ? "picked" : undefined}>
              <label>
                <input type="checkbox" checked={Boolean(d)} disabled={disabled} onChange={() => toggle(m)} />
                <span>{m.name}</span>
              </label>
              {d ? (
                <span className="impact-who-fields">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={d.minutes}
                    placeholder="min"
                    aria-label={`${m.name} minutes`}
                    disabled={disabled}
                    onChange={(e) => update(m.userId, { minutes: e.target.value })}
                  />
                  <input
                    value={d.role}
                    placeholder="role (optional)"
                    aria-label={`${m.name} role`}
                    maxLength={80}
                    disabled={disabled}
                    onChange={(e) => update(m.userId, { role: e.target.value })}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <small className="app-muted">
        Minutes are each person&rsquo;s own time. Leave it blank if you don&rsquo;t know — it will show as
        &ldquo;time not recorded&rdquo; rather than count as zero.
      </small>
    </div>
  );
}

export function draftsToPayload(drafts: ParticipantDraft[]) {
  return drafts.map((d) => ({
    userId: d.userId,
    minutes: d.minutes.trim() === "" ? null : Number(d.minutes),
    role: d.role.trim() || null,
  }));
}

/** Names on an activity row, with minutes where recorded. */
export function ParticipantNames({ activity }: { activity: ImpactActivity }) {
  if (activity.participants.length === 0) return null;
  return (
    <small className="impact-names">
      {activity.participants.map((p, i) => (
        <span key={p.userId}>
          {i > 0 ? ", " : ""}
          {p.name}
          {p.minutes == null ? "" : ` (${Math.round(p.minutes / 6) / 10}h)`}
        </span>
      ))}
      {activity.participants.length < activity.participantCount
        ? ` + ${activity.participantCount - activity.participants.length} unnamed`
        : ""}
    </small>
  );
}

/**
 * Per-person outreach for the season. Hours come only from recorded minutes;
 * an appearance with no minutes is listed, not counted, so nobody's total is
 * padded by an event they were credited for without a time.
 */
export function PeoplePanel({ people, seasonYear }: { people: PersonOutreachTotal[]; seasonYear: number }) {
  if (people.length === 0) return null;
  return (
    <section className="app-card soft-panel impact-people" aria-label="Outreach by person">
      <span className="biz-overline">By person</span>
      <h2>Outreach hours, {seasonYear}</h2>
      <table>
        <thead>
          <tr>
            <th>Person</th>
            <th>Events</th>
            <th>Hours</th>
            <th>Not recorded</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.userId}>
              <td>{p.name}</td>
              <td>{p.events}</td>
              <td>{p.hours}</td>
              <td>{p.unrecorded > 0 ? `${p.unrecorded} event${p.unrecorded === 1 ? "" : "s"}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="app-muted">
        Only named participation counts here. Hours are the person&rsquo;s own recorded minutes, not the
        event&rsquo;s length.
      </small>
    </section>
  );
}
