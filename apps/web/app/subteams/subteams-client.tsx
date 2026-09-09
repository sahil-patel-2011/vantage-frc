"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel } from "../../components/ui";
import {
  SUBTEAM_LABELS,
  TEAM_ROLE_LABELS,
  type SubteamMember,
  type SubteamProgress,
} from "../../lib/subteams/store";

type View = {
  orgName: string;
  canManage: boolean;
  progress: SubteamProgress | null;
};

/**
 * What each person still owes, in words rather than a score.
 *
 * Deliberately not a percentage or a "readiness" number: a mentor needs to know
 * that Maya has not confirmed the safety notice, not that she is 67% complete.
 * Returning an empty list is the normal, good case.
 */
function owed(member: SubteamMember): string[] {
  const items: string[] = [];
  if (!member.onboarded) items.push("has not finished onboarding");
  if (member.outstandingForms > 0) {
    items.push(`${member.outstandingForms} form${member.outstandingForms === 1 ? "" : "s"} to fill in`);
  }
  if (member.unacknowledgedNotices > 0) {
    items.push(
      `${member.unacknowledgedNotices} notice${member.unacknowledgedNotices === 1 ? "" : "s"} to confirm`,
    );
  }
  return items;
}

function MemberRow({ member }: { member: SubteamMember }) {
  const items = owed(member);
  return (
    <li className={items.length > 0 ? "st-member owed" : "st-member"}>
      <span className="st-member-name">
        <strong>{member.displayName}</strong>
        {member.teamRole ? (
          <small className="app-muted">{TEAM_ROLE_LABELS[member.teamRole] ?? member.teamRole}</small>
        ) : null}
      </span>
      <span className="st-member-state">
        {items.length === 0 ? (
          <small className="app-muted">Up to date</small>
        ) : (
          <small>{items.join(" · ")}</small>
        )}
      </span>
    </li>
  );
}

/**
 * Where a mentor goes to settle what this group owes.
 *
 * Without these the page is a read-only dead end: it tells you four people have
 * not confirmed a notice and gives you nowhere to go. Only the links that are
 * actually relevant to this group are rendered.
 */
function GroupActions({ members }: { members: SubteamMember[] }) {
  const forms = members.some((member) => member.outstandingForms > 0);
  const notices = members.some((member) => member.unacknowledgedNotices > 0);
  if (!forms && !notices) return null;
  return (
    <div className="st-actions">
      {notices ? (
        <a className="app-button secondary" href="/announcements">
          Open announcements
        </a>
      ) : null}
      {forms ? (
        <a className="app-button secondary" href="/forms">
          Open forms
        </a>
      ) : null}
    </div>
  );
}

export default function SubteamsClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/subteams");
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not load subteams.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !view) {
    return (
      <main className="module-page subteams-page">
        <PageHeader breadcrumbs="Team / Subteam progress" title="Subteam progress" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="Subteam progress needs a team workspace" description={error}>
          <a className="app-button" href="/workspace">Choose team</a>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page subteams-page">
        <PageHeader breadcrumbs="Team / Subteam progress" title="Subteam progress" />
        <Panel><p className="app-muted">Loading…</p></Panel>
      </main>
    );
  }

  if (!view.canManage || !view.progress) {
    return (
      <main className="module-page subteams-page">
        <PageHeader breadcrumbs="Team / Subteam progress" title="Subteam progress" />
        <EmptyState
          soft
          badge="Leads only"
          badgeTone="setup"
          title="This view is for mentors and coaches"
          description="It shows who on each subteam still owes a form or has not confirmed a required notice, so it is limited to owners and admins."
        >
          <a className="app-button" href="/team">Open Team</a>
        </EmptyState>
      </main>
    );
  }

  const { progress } = view;
  const attention = progress.subteams.reduce((total, group) => total + group.needsAttention.length, 0);

  return (
    <main className="module-page subteams-page">
      <PageHeader
        breadcrumbs="Team / Subteam progress"
        title="Subteam progress"
        description={`Who is on each subteam in ${view.orgName}, and what each of them still owes.`}
      />

      <Panel className="st-summary">
        <div>
          <strong>{progress.totalMembers}</strong>
          <small className="app-muted">on the team</small>
        </div>
        <div>
          <strong>{progress.studentCount}</strong>
          <small className="app-muted">students</small>
        </div>
        <div>
          <strong>{progress.mentorCount}</strong>
          <small className="app-muted">mentors &amp; coaches</small>
        </div>
        <div>
          <strong>{attention + progress.unassigned.length}</strong>
          <small className="app-muted">need a follow-up</small>
        </div>
      </Panel>

      {progress.totalMembers === 0 ? (
        <EmptyState
          soft
          badge="No members"
          badgeTone="setup"
          title="Nobody has joined yet"
          description="Invite your team, and everyone who finishes onboarding will appear here under the subteam they picked."
        >
          <a className="app-button" href="/team/admin">Invite people</a>
        </EmptyState>
      ) : null}

      {progress.unassigned.length > 0 ? (
        <Panel className="st-group st-unassigned">
          <header>
            <h2>No subteam yet</h2>
            <Badge tone="setup">{progress.unassigned.length}</Badge>
          </header>
          <p className="app-muted">
            These people finished onboarding without picking a subteam, or joined before they were asked. They are the
            easiest people on the team to lose.
          </p>
          <ul className="st-members">
            {progress.unassigned.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
          <GroupActions members={progress.unassigned} />
        </Panel>
      ) : null}

      {progress.subteams.map((group) => (
        <Panel key={group.id} className="st-group">
          <header>
            <h2>{SUBTEAM_LABELS[group.id] ?? group.label}</h2>
            <span className="st-group-meta">
              <small className="app-muted">
                {group.members.length} {group.members.length === 1 ? "person" : "people"}
              </small>
              {group.needsAttention.length > 0 ? (
                <Badge tone="setup">{group.needsAttention.length} to follow up</Badge>
              ) : (
                <Badge tone="good">All clear</Badge>
              )}
            </span>
          </header>
          <ul className="st-members">
            {group.members.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
          <GroupActions members={group.members} />
        </Panel>
      ))}
    </main>
  );
}
