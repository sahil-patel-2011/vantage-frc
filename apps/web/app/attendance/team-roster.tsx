"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";

type Member = { userId: string; name: string; role: string; you: boolean };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Mentor or coach", scout: "Student", viewer: "Parent or guest" };

/** Who is on the team, shown first on People. Owners and admins get the invite button. */
export function TeamRoster({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    void fetch(`/api/team/roster?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { members?: Member[]; canManage?: boolean; error?: string };
        if (!active) return;
        if (!response.ok || !data.members) setError(data.error ?? "Couldn't load the team list.");
        else {
          setMembers(data.members);
          setCanManage(Boolean(data.canManage));
        }
      })
      .catch(() => active && setError("Couldn't reach Vantage. Check your connection."));
    return () => {
      active = false;
    };
  }, [orgId]);

  return (
    <section className="team-roster app-card soft-panel" aria-labelledby="team-roster-title">
      <header className="team-roster-head">
        <h2 id="team-roster-title">
          Team{members ? <small> · {members.length}</small> : null}
        </h2>
        {/* Roles, invites and removing someone live in Team admin; People said so only through
            names drawn as underlined blue links. One labelled way in instead. */}
        {canManage ? (
          <Button as="a" variant="secondary" size="sm" href={withOrgHref("/team/admin", orgId)}>
            Manage people and invites
          </Button>
        ) : null}
      </header>
      {error ? (
        <p className="app-muted">{error}</p>
      ) : !members ? (
        <p className="app-muted">Loading the team…</p>
      ) : (
        <ul className="team-roster-list">
          {members.map((member) => (
            <li key={member.userId}>
              <span className="team-roster-avatar" aria-hidden="true">
                {member.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="team-roster-name">
                {member.name}
                {member.you ? <small> (you)</small> : null}
              </span>
              <span className={`team-roster-role role-${member.role}`}>{ROLE_LABEL[member.role] ?? member.role}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
