"use client";
import { useState } from "react";
import { ROLE_LABELS, roleLabel, rolePhrase } from "@vantage/core/role-words";
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
  // The role words every screen uses, and each person's access beside their name: handing a team
  // to a parent or guest by mistake was one unlabeled choice away (QA A3-16).
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={owner ? "Hand over team" : "Change my access"}
    description={owner ? "Choose a teammate who has joined. They’ll run the team, and your work stays with it." : "Another owner or mentor or coach must stay on the team."}>
    <div className="team-handover-fields">
      {owner ? <label>New team owner
        <select value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)}>
          <option value="">Choose a teammate…</option>
          {people.map(member => <option key={member.userId} value={member.userId}>{member.name || member.email} · {roleLabel(member.role)}</option>)}
        </select>
        {!people.length ? <small>Invite your lead first. They’ll appear here after they join.</small> : null}
      </label> : null}
      <label>My access after this
        <select value={role} disabled={busy} onChange={event => setRole(event.target.value)}>
          {owner ? <option value="admin">{ROLE_LABELS.admin}</option> : null}
          <option value="scout">{ROLE_LABELS.scout}</option><option value="viewer">{ROLE_LABELS.viewer}</option>
        </select>
      </label>
      {chosen ? <p className="app-muted">
        {chosen.name || chosen.email} becomes the owner, with full control of people, settings and billing, and we’ll tell them.
        {chosen.role === "viewer" || chosen.role === "scout" ? ` They are ${rolePhrase(chosen.role)} now, so check this is the right person.` : ""}
        {" "}You’ll be {rolePhrase(role)}.
      </p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="team-admin-dialog-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" disabled={busy || (owner && !recipient)} onClick={() => void save()}>{busy ? "Saving…" : owner ? "Hand over and update my access" : "Update my access"}</Button>
      </div>
    </div>
  </Modal>;
}
