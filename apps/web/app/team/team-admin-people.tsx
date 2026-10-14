"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS, type AccessRole } from "@vantage/core/role-words";
import { ActionMenu, Panel } from "../../components/ui";
import { filterMembers, memberAccessLine } from "../../lib/team/people-list";
import type { Member } from "./team-admin-model";

/** A long team gets a search box and a role filter; a short one doesn't need them. */
const SEARCH_FROM = 9;

/**
 * One people list. Each row: who they are, their role in plain words, and one
 * "Access" control. Password reset and Remove are quiet items behind "More";
 * neither is offered on your own row.
 */
export function TeamAdminPeople({
  members,
  actorUserId,
  actorRole,
  busyUserId,
  onAccess,
  onPasswordReset,
  onRemove,
  onStepDown,
  permissionsHref,
}: {
  members: Member[];
  /** The one-table view of everyone's access (Roles and permissions). */
  permissionsHref?: string;
  actorUserId: string | null;
  actorRole: string | null;
  busyUserId: string | null;
  onAccess: (member: Member) => void;
  onPasswordReset: (member: Member) => void;
  onRemove: (member: Member) => void;
  onStepDown: () => void;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const searchable = members.length >= SEARCH_FROM;
  const shown = useMemo(
    () => (searchable ? filterMembers(members, query, roleFilter) : members),
    [members, query, roleFilter, searchable],
  );
  return (
    <section className="team-admin-people" id="people" aria-labelledby="people-title">
      <div className="team-admin-people-head">
        <h2 id="people-title">People ({members.length})</h2>
        {permissionsHref ? (
          <a className="team-admin-people-grid-link" href={permissionsHref}>
            Roles and permissions for everyone
          </a>
        ) : null}
      </div>
      {searchable ? (
        <div className="team-admin-people-find" role="search">
          <label>
            <span className="app-muted">Find someone</span>
            <input
              type="search"
              value={query}
              placeholder="Name or email"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="app-muted">Access</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">Everyone</option>
              {(Object.keys(ROLE_LABELS) as AccessRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          {query || roleFilter ? (
            <p className="app-muted" role="status">
              Showing {shown.length} of {members.length}.
            </p>
          ) : null}
        </div>
      ) : null}
      <Panel className="team-admin-members invite-list" aria-label="Members list">
        {shown.length === 0 ? <p className="app-muted">Nobody matches. Clear the search to see everyone.</p> : null}
        {shown.map((member) => {
          const self = member.userId === actorUserId;
          // An owner can change or remove another owner and anyone else; a mentor or coach can
          // change and remove students and parents or guests.
          const canManage =
            !self &&
            (actorRole === "owner" || (member.role !== "owner" && member.role !== "admin"));
          const who = member.name || member.email;
          return (
            <article key={member.userId}>
              <div>
                <strong>
                  {who}
                  {self ? <span className="team-member-you"> (you)</span> : null}
                </strong>
                <small>
                  {memberAccessLine(member)}
                  {member.email && member.email !== who ? ` · ${member.email}` : ""}
                </small>
              </div>
              <div className="team-member-actions">
                {self ? (
                  <ActionMenu label="My team access" tone="row" maxSecondary={0} overflowLabel="More" actions={[
                    { id: "step-down", label: actorRole === "owner" ? "Hand over team" : "Change my access", onClick: onStepDown },
                  ]} />
                ) : (
                  <ActionMenu
                    label={`Actions for ${who}`}
                    tone="row"
                    maxSecondary={0}
                    overflowLabel="More"
                    triggerTestId={`member-more-${member.userId}`}
                    actions={[
                      // Another owner's access is for an owner to change; everyone else sees no
                      // Access button on an owner (it opened a dialog that said only that).
                      ...(member.role === "owner" && actorRole !== "owner"
                        ? []
                        : [
                            {
                              id: "access",
                              label: busyUserId === member.userId ? "Working…" : "Access",
                              intent: "primary" as const,
                              disabled: busyUserId === member.userId,
                              onClick: () => onAccess(member),
                            },
                          ]),
                      {
                        id: "reset",
                        label: "Send password reset",
                        hint: "They choose a new password from the email",
                        onClick: () => onPasswordReset(member),
                      },
                      ...(canManage
                        ? [
                            {
                              id: "remove",
                              label: "Remove from team",
                              onClick: () => onRemove(member),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            </article>
          );
        })}
      </Panel>
    </section>
  );
}
