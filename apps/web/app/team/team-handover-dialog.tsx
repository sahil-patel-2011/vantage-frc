"use client";
import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import type { Member } from "./team-admin-model";

export function TeamHandoverDialog({ orgId, actorUserId, owner, members, onClose }: {
  orgId: string; actorUserId: string; owner: boolean; members: Member[]; onClose: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [role, setRole] = useState("scout");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const people = members.filter(member => member.userId !== actorUserId);
  const chosen = people.find(member => member.userId === recipient);
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/organizations/members", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: owner ? "handover" : "set_role", userId: owner ? recipient : actorUserId, role }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Your access didn’t change. Try again."); return; }
      window.location.assign(`/dashboard?orgId=${encodeURIComponent(orgId)}`);
    } catch { setError("Your access didn’t change. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={owner ? "Hand over team" : "Change my access"}
    description={owner ? "Choose a teammate who has joined. They’ll manage the team, and your work stays with it." : "Another owner or admin must remain on the team."}>
    <div className="team-handover-fields">
      {owner ? <label>New team owner
        <select value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)}>
          <option value="">Choose a teammate…</option>
          {people.map(member => <option key={member.userId} value={member.userId}>{member.name || member.email}</option>)}
        </select>
        {!people.length ? <small>Invite your lead first. They’ll appear here after they join.</small> : null}
      </label> : null}
      <label>My access after this
        <select value={role} disabled={busy} onChange={event => setRole(event.target.value)}>
          {owner ? <option value="admin">Team admin</option> : null}
          <option value="scout">Team member</option><option value="viewer">View only</option>
        </select>
      </label>
      {chosen ? <p className="app-muted">{chosen.name || chosen.email} will have full team control, including people, settings and billing. You’ll {role === "admin" ? "stay a team admin" : role === "scout" ? "participate as a team member" : "have view-only access"}.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="team-admin-dialog-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" disabled={busy || (owner && !recipient)} onClick={() => void save()}>{busy ? "Saving…" : owner ? "Hand over and update my access" : "Update my access"}</Button>
      </div>
    </div>
  </Modal>;
}
