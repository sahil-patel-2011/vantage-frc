"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "../../../components/ui";
import type { KeyShareScope } from "../../../lib/ai-keys/key-sharing";
import type { MemberKeyRow } from "./ai-keys-model";

export function AiKeySharing({ orgId, row, ready, members, onSaved }: {
  orgId: string; row: MemberKeyRow; ready: boolean;
  members: { userId: string; name: string | null }[]; onSaved: () => void;
}) {
  const groupId = useId();
  const savedScope = row.shareScope ?? "personal";
  const savedIds = JSON.stringify(row.shareUserIds ?? []);
  const [scope, setScope] = useState<KeyShareScope>(savedScope);
  const [lastSharedScope, setLastSharedScope] = useState<"team" | "selected">(savedScope === "selected" ? "selected" : "team");
  const [selected, setSelected] = useState<string[]>(row.shareUserIds ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setScope(savedScope); setLastSharedScope(savedScope === "selected" ? "selected" : "team"); setSelected(JSON.parse(savedIds) as string[]); }, [savedScope, savedIds]);
  const formerRecipients = selected.filter(id => !members.some(member => member.userId === id));
  if (!row.id) return null;
  const changed = scope !== savedScope || (scope === "selected" && JSON.stringify([...selected].sort()) !== JSON.stringify([...(row.shareUserIds ?? [])].sort()));
  return <form className="ai-key-sharing" onSubmit={async event => {
    event.preventDefault();
    if (busy || !ready || !changed) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/organizations/ai-keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "update_key", keyId: row.id, scope: "member", shareScope: scope, shareUserIds: scope === "selected" ? selected : [] }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setMessage(data.error || "Sharing wasn’t saved."); setFailed(true); return; }
      setMessage(scope === "personal" ? "Private use saved." : "Sharing saved."); onSaved();
    } catch { setMessage("The server didn’t respond. Check your connection and try again."); setFailed(true); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy || !ready}>
      <legend className="sr-only">Who can use {row.label || row.provider}</legend>
      <label className="ai-key-share-toggle"><input type="checkbox" checked={scope !== "personal"} onChange={event => setScope(event.target.checked ? lastSharedScope : "personal")} /><span>Let teammates use my AI credits</span></label>
      <small className="app-muted">{scope === "personal" ? "Only you can use this key." : "Uses your provider’s allowance. Your key stays hidden from teammates."}</small>
      {scope !== "personal" ? <>
        <div className="ai-key-share-scope">
          <label><input type="radio" name={groupId} checked={scope === "team"} onChange={() => { setScope("team"); setLastSharedScope("team"); }} /> Whole team</label>
          <label><input type="radio" name={groupId} checked={scope === "selected"} onChange={() => { setScope("selected"); setLastSharedScope("selected"); }} /> Selected people</label>
        </div>
        {scope === "selected" ? <div className="ai-key-share-members" role="group" aria-label="People who may use your key">
          {members.map(member => <label key={member.userId}><input type="checkbox" checked={selected.includes(member.userId)} onChange={event => setSelected(ids => event.target.checked ? [...ids, member.userId] : ids.filter(id => id !== member.userId))} /> {member.name || "Unnamed team member"}</label>)}
          {formerRecipients.map((id, index) => <label key={id}><input type="checkbox" checked onChange={() => setSelected(ids => ids.filter(value => value !== id))} /> Former teammate {index + 1} · uncheck to remove</label>)}
          {formerRecipients.length ? <small className="app-muted">Former teammates cannot use this key. Remove them before saving a new selection.</small> : null}
          {!members.length ? <p className="app-muted">No other teammates yet.</p> : null}
        </div> : null}
      </> : null}
      {changed ? <Button variant="secondary" type="submit" disabled={busy || (scope === "selected" && (selected.length === 0 || formerRecipients.length > 0))}>{busy ? "Saving…" : "Save sharing"}</Button> : null}
    </fieldset>
    {!ready ? <small className="app-muted">Sharing isn’t available on this deployment yet. This key is private.</small> : null}
    {message ? <p className={failed ? "status-bad" : "status-good"} role={failed ? "alert" : "status"}>{message}</p> : null}
  </form>;
}
