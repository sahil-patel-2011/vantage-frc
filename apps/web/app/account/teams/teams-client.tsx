"use client";

import { useState } from "react";
import { ActionMenu, askConfirm, type ActionSpec } from "../../../components/ui";
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

  function teamActions(team: TeamLifecycleView, current: boolean): ActionSpec[] {
    const actions: ActionSpec[] = [
      {
        id: "open",
        label: current ? "Open" : "Switch to this team",
        href: current ? "/dashboard" : `/dashboard?orgId=${encodeURIComponent(team.orgId)}`,
        intent: "primary",
      },
    ];
    // Leave asks in its own dialog, which says what leaving costs; Delete opens the typed
    // confirmation. Neither needs the menu's extra "press again" step on top.
    if (team.canLeave) {
      actions.push({
        id: "leave",
        label: busyOrg === team.orgId ? "Leaving…" : "Leave team",
        disabled: busyOrg === team.orgId,
        onClick: () => void leave(team),
        intent: "destructive",
        confirmsItself: true,
        group: "out",
      });
    }
    if (team.canDelete) {
      actions.push({
        id: "delete",
        label: "Delete team…",
        onClick: () => setDeleting(team),
        intent: "destructive",
        confirmsItself: true,
        group: "out",
      });
    }
    return actions;
  }

  return (
    <>
      <ul className="lifecycle-team-list">
        {teams.map((team) => {
          const lastOwner = team.role === "owner" && !team.otherOwner;
          return (
            <li key={team.orgId}>
              <div className="lifecycle-team-open">
                <strong>
                  {teamDisplayName(team)}
                  {team.orgId === currentOrgId ? <span className="lifecycle-current">Current</span> : null}
                </strong>
                <small>
                  {accessRoleLabel(team.role)} · {peopleLabel(team.memberCount)}
                </small>
              </div>
              {/* The way in stays one tap away; the ways out (leave, delete) are behind More,
                  apart from it, each with its own confirmation. Delete team used to sit right
                  beside Switch, styled almost the same. */}
              <ActionMenu
                className="lifecycle-team-actions"
                label={`${teamDisplayName(team)} actions`}
                tone="row"
                triggerTestId={`team-actions-${team.orgId}`}
                actions={teamActions(team, team.orgId === currentOrgId)}
              />
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
