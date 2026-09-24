"use client";

import { ActionMenu, Panel } from "../../components/ui";
import { ROLE_LABELS } from "./admin/member-access-panel";
import type { Member } from "./team-admin-model";

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
}: {
  members: Member[];
  actorUserId: string | null;
  actorRole: string | null;
  busyUserId: string | null;
  onAccess: (member: Member) => void;
  onPasswordReset: (member: Member) => void;
  onRemove: (member: Member) => void;
}) {
  return (
    <section className="team-admin-people" id="people" aria-labelledby="people-title">
      <h2 id="people-title">People ({members.length})</h2>
      <Panel className="team-admin-members invite-list" aria-label="Members list">
        {members.map((member) => {
          const self = member.userId === actorUserId;
          const canManage =
            !self && member.role !== "owner" && (member.role !== "admin" || actorRole === "owner");
          const who = member.name || member.email;
          const extras = (member.capabilities ?? []).length;
          return (
            <article key={member.userId}>
              <div>
                <strong>
                  {who}
                  {self ? <span className="team-member-you"> (you)</span> : null}
                </strong>
                <small>
                  {ROLE_LABELS[member.role] ?? member.role}
                  {extras && (member.role === "scout" || member.role === "viewer")
                    ? ` · ${extras} extra power${extras === 1 ? "" : "s"}`
                    : ""}
                  {member.email && member.email !== who ? ` · ${member.email}` : ""}
                </small>
              </div>
              <div className="team-member-actions">
                {self ? null : (
                  <ActionMenu
                    label={`Actions for ${who}`}
                    tone="row"
                    maxSecondary={0}
                    overflowLabel="More"
                    triggerTestId={`member-more-${member.userId}`}
                    actions={[
                      {
                        id: "access",
                        label: busyUserId === member.userId ? "Working…" : "Access",
                        intent: "primary",
                        disabled: busyUserId === member.userId,
                        onClick: () => onAccess(member),
                      },
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
