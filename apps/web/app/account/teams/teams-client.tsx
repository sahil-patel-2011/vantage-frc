"use client";

import { useRef, useState } from "react";
import { Button, Panel } from "../../../components/ui";
import { ConfirmProvider, useConfirm } from "../../../components/ui/confirm-dialog";
import { Icon } from "../../../components/icon";
import { forgetOfflineTeam } from "../../../lib/offline/identity";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import "./teams.css";

export type AccountTeam = { id: string; name: string; number: number | null; role: string };
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Mentor or coach", scout: "Student", viewer: "Parent or guest" };

export function TeamsClient(props: { teams: AccountTeam[]; userId: string; currentOrgId?: string }) {
  return <ConfirmProvider key={props.userId}><TeamsList {...props} /></ConfirmProvider>;
}

function TeamsList({ teams, userId, currentOrgId }: { teams: AccountTeam[]; userId: string; currentOrgId?: string }) {
  const confirm = useConfirm();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function leave(team: AccountTeam) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!(await confirm({ title: `Leave ${team.number ? `Team ${team.number}` : team.name}?`,
        body: "You’ll lose access to this team. Your account and the team’s saved work stay intact. Upload unsent scouting reports first; they cannot sync after you leave. You’ll need a new invitation or team join code to return.",
        confirmLabel: "Leave team", tone: "destructive" }))) return;
      setBusy(team.id);
      setError("");
      const response = await fetch("/api/organizations/leave", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: team.id }), signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(typeof result?.error === "string" ? result.error : "Leaving was not confirmed. Refresh your teams before trying again.");
        return;
      }
      if (result?.left !== true || result.orgId !== team.id) throw new Error("Unconfirmed departure");
      forgetOfflineTeam(team.id, userId);
      // A full navigation refreshes the shell, role checks and selected team together.
      window.location.replace("/account/teams?left=1");
    } catch { setError("Leaving was not confirmed. Refresh your teams before trying again."); }
    finally { busyRef.current = false; setBusy(null); }
  }

  return <Panel className="account-teams-panel">
    {error ? <div role="alert" className="account-team-error"><p>{error}</p><Button as="a" variant="secondary" href="/account/teams">Refresh teams</Button></div> : null}
    {teams.length ? <ul className="account-team-list">{teams.map(team => <li key={team.id}>
      <a className="account-team-open" href={`/dashboard?orgId=${team.id}`} aria-current={team.id === currentOrgId ? "true" : undefined}>
        <i><Icon name="users" /></i><span><strong>{team.number ? `Team ${team.number}` : team.name}</strong>
          <small>{team.number ? `${team.name} · ` : ""}{ROLE_LABELS[team.role] ?? team.role}{team.id === currentOrgId ? " · Current team" : ""}</small></span><Icon name="chevron" />
      </a>
      {team.role === "owner" ? <a className="account-team-handover" href={`/team/admin?orgId=${team.id}`}>Hand over ownership</a>
        : <Button variant="secondary" type="button" disabled={Boolean(busy)} onClick={() => void leave(team)}>{busy === team.id ? "Leaving…" : "Leave team"}</Button>}
    </li>)}</ul> : <p>No team yet. Create one or use an invitation.</p>}
    <div className="account-team-join"><Button as="a" variant="primary" href="/join-team">Join a team</Button><Button as="a" variant="secondary" href="/claim">Create a team</Button></div>
  </Panel>;
}
