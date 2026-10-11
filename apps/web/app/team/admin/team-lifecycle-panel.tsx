"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components/ui";
import { TeamDeleteDialog } from "../../account/teams/lifecycle-dialogs";
import { TEAM_NAME_MAX, normalizeTeamName } from "../../../lib/team-lifecycle/model";
import type { TeamLifecycleView } from "../../../lib/team-lifecycle/store";
import "../../account/teams/team-lifecycle.css";

/**
 * Team profile: the team's name at the top (owners and team admins) and the owner's "Delete this
 * team" at the bottom, under everything else. Leaving a team is on Your teams, for everyone.
 */

const loads = new Map<string, Promise<TeamLifecycleView | null>>();

/** One read for both panels on the page. */
function loadTeam(orgId: string): Promise<TeamLifecycleView | null> {
  let pending = loads.get(orgId);
  if (!pending) {
    pending = fetch(`/api/organizations/lifecycle?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { team?: TeamLifecycleView }).team ?? null : null))
      .catch(() => null)
      .finally(() => window.setTimeout(() => loads.delete(orgId), 0));
    loads.set(orgId, pending);
  }
  return pending;
}

function useTeam(orgId: string) {
  const [team, setTeam] = useState<TeamLifecycleView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadTeam(orgId).then((value) => {
      if (!cancelled) setTeam(value);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);
  return [team, setTeam] as const;
}

export function TeamLifecyclePanel({ orgId }: { orgId: string }) {
  const [team, setTeam] = useTeam(orgId);
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Nothing to offer a team member or view-only person here, and nothing until we know.
  if (!team?.canRename) return null;
  const value = name ?? team.name;
  const cleaned = normalizeTeamName(value);
  const changed = cleaned !== null && cleaned !== team.name;

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!changed || !team) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/organizations/lifecycle", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, name: value }),
      });
      const data = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!response.ok || !data.name) {
        setError(data.error ?? "The team name didn't change. Try again.");
        return;
      }
      setTeam({ ...team, name: data.name });
      setName(data.name);
      setMessage(`Saved. Everyone on the team now sees "${data.name}".`);
    } catch {
      setError("The team name didn't change. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="intel-panel" aria-labelledby="team-name-title">
      <span className="eyebrow">TEAM NAME</span>
      <form className="lifecycle-rename" onSubmit={(event) => void rename(event)}>
        <label htmlFor="team-name-input" id="team-name-title">
          What your team is called in Vantage
        </label>
        <div className="lifecycle-rename-row">
          <input
            id="team-name-input"
            value={value}
            maxLength={TEAM_NAME_MAX}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={busy || !changed}>
            {busy ? "Saving…" : "Save name"}
          </Button>
        </div>
        <small className="app-muted">
          {team.teamNumber != null
            ? `Your team number, ${team.teamNumber}, stays the same. If the number is wrong, contact Vantage support.`
            : "Shown in the top bar and on every page."}
        </small>
      </form>
      {message ? <p role="status" className="telemetry-status success">{message}</p> : null}
      {error ? <p role="alert" className="lifecycle-error">{error}</p> : null}
    </section>
  );
}

export function TeamDeletePanel({ orgId }: { orgId: string }) {
  const [team] = useTeam(orgId);
  const [deleting, setDeleting] = useState(false);
  if (!team?.canDelete) return null;
  const others = Math.max(0, team.memberCount - 1);
  return (
    <section className="intel-panel lifecycle-danger" aria-labelledby="team-delete-title">
      <span className="eyebrow">DELETE TEAM</span>
      <h2 id="team-delete-title">Delete this team</h2>
      <p className="app-muted">
        Removes the team and everything in it, for you{others ? ` and the ${others} other ${others === 1 ? "person" : "people"} on it` : ""}.
        Everyone keeps their own Vantage account. You can download the team&rsquo;s data first.
      </p>
      <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
        Delete team…
      </Button>
      {deleting ? <TeamDeleteDialog team={team} onClose={() => setDeleting(false)} /> : null}
    </section>
  );
}
