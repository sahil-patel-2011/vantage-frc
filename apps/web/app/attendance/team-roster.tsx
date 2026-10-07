"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";

type Member = { userId: string; name: string; role: string; you: boolean };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Team admin", scout: "Team member", viewer: "View only" };

/** Who is on the team, with invitations available to authorized member managers. */
export function TeamRoster({ orgId, onAccessChange, onError, onManage }: { orgId: string; onAccessChange?: (allowed: boolean | null) => void; onError?: (message: string | null) => void; onManage?: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    const controller = new AbortController();
    setMembers(null); setError(null); setCanManage(false); onAccessChange?.(null); onError?.(null);
    const fail = (message: string) => { setError(message); onError?.(message); onAccessChange?.(false); };
    void fetch(`/api/team/roster?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { members?: Member[]; canManage?: boolean; error?: string };
        if (!active) return;
        if (!response.ok || !Array.isArray(data.members) || !data.members.every(member => member && typeof member.userId === "string" && typeof member.name === "string" && typeof member.role === "string")) fail(typeof data.error === "string" ? data.error : "Couldn't load the team list.");
        else {
          setMembers(data.members);
          setCanManage(data.canManage === true);
          onAccessChange?.(data.canManage === true);
        }
      })
      .catch(() => { if (active) fail("Couldn't reach Vantage. Check your connection."); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [orgId, onAccessChange, onError, attempt]);

  return (
    <section className="team-roster app-card soft-panel" aria-labelledby="team-roster-title">
      <header className="team-roster-head">
        <h2 id="team-roster-title">
          Team{members ? <small> · {members.length}</small> : null}
        </h2>
        {/* Roles, invites and removing someone live in Team admin; People said so only through
            names drawn as underlined blue links. One labelled way in instead. */}
        {canManage ? (
          onManage ? <Button variant="primary" onClick={onManage}>Invite people</Button> : <Button as="a" variant="secondary" size="sm" href={withOrgHref("/team/admin", orgId)}>Manage people and invites</Button>
        ) : null}
      </header>
      {error ? (
        <div><p role="alert">{error}</p><Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>
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
