"use client";

import { useState } from "react";
import { askConfirm, Button } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { accessRoleLabel, teamDisplayName } from "../../../lib/team-lifecycle/model";
import type { TeamLifecycleView } from "../../../lib/team-lifecycle/store";
import { TeamDeleteDialog } from "./lifecycle-dialogs";

function peopleLabel(count: number) {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/** Your teams, each with the way in and the way out (leave, or for an owner, hand over or delete). */
export function TeamsList({ teams, currentOrgId }: { teams: TeamLifecycleView[]; currentOrgId: string | null }) {
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<TeamLifecycleView | null>(null);

  async function leave(team: TeamLifecycleView) {
    const label = teamDisplayName(team);
    const ok = await askConfirm({
      title: `Leave ${label}?`,
      body: "You'll lose access to this team right away. Work you added stays with the team. To come back, you'll need a new invite or the team's join code.",
      confirmLabel: "Leave team",
      tone: "destructive",
    });
    if (!ok) return;
    setBusyOrg(team.orgId);
    setMessage("");
    try {
      const response = await fetch("/api/organizations/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: team.orgId, action: "leave" }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "You're still on the team. Try again in a minute.");
        return;
      }
      // A full load: the top bar's team list and the remembered team both change.
      window.location.assign(`/account/teams?left=${encodeURIComponent(label)}`);
    } catch {
      setMessage("You're still on the team. Check your connection and try again.");
    } finally {
      setBusyOrg(null);
    }
  }

  return (
    <>
      <ul className="lifecycle-team-list">
        {teams.map((team) => {
          const lastOwner = team.role === "owner" && !team.otherOwner;
          return (
            <li key={team.orgId}>
              <div className="lifecycle-team-open">
                <strong>{teamDisplayName(team)}</strong>
                <small>
                  {accessRoleLabel(team.role)} · {peopleLabel(team.memberCount)}
                  {team.orgId === currentOrgId ? " · Open now" : ""}
                </small>
              </div>
              <div className="lifecycle-team-actions">
                {team.orgId !== currentOrgId ? <Button as="a" variant="secondary" size="sm" href={`/dashboard?orgId=${encodeURIComponent(team.orgId)}`}>Switch to this team</Button> : null}
                {team.canLeave ? (
                  <Button type="button" variant="secondary" size="sm" disabled={busyOrg === team.orgId} onClick={() => void leave(team)}>
                    {busyOrg === team.orgId ? "Leaving…" : "Leave"}
                  </Button>
                ) : null}
                {team.canDelete ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(team)}>
                    Delete team
                  </Button>
                ) : null}
              </div>
              {lastOwner ? (
                <p className="lifecycle-team-note">
                  You&rsquo;re this team&rsquo;s only owner. To leave, first{" "}
                  <a href={withOrgHref("/team/admin", team.orgId)}>hand the team over</a> to someone who has joined, or delete the team.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {message ? <p role="alert" className="lifecycle-error lifecycle-status">{message}</p> : null}
      {deleting ? <TeamDeleteDialog team={deleting} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}
