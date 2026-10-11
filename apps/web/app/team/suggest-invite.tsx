"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ROLE_LABELS } from "@vantage/core/role-words";
import { Button } from "../../components/ui";
import { inviteEmailProblem } from "../../lib/team/invite-email-address";
import { suggestionSentMessage, teamLeadsLine } from "../../lib/team/invite-suggestion";
import "./team-people-invites.css";

type RosterRow = { name: string; role: string; you?: boolean };

/**
 * "Ask the owner to invite someone", for people who can't invite (a student, a parent).
 * A student whose coach wanted to join had no way to say so in the app: Team admin only said
 * "Team administrator access required" (QA A3-04). This sends the owner and mentors a notice
 * with the address and the access suggested; they send the invite from Team admin.
 */
export function SuggestInvite({
  orgId,
  compact = false,
  leadNames,
}: {
  orgId: string;
  compact?: boolean;
  /** Who runs the team, when the caller already has the roster (saves a second fetch). */
  leadNames?: string[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "scout" | "viewer">("admin");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [fetchedLeads, setLeads] = useState<string[] | null>(null);
  const leads = leadNames ?? fetchedLeads;
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    if (!orgId || leadNames) return;
    let active = true;
    void fetch(`/api/team/roster?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { members?: RosterRow[] };
        if (!active || !response.ok || !Array.isArray(data.members)) return;
        setLeads(data.members.filter((row) => (row.role === "owner" || row.role === "admin") && !row.you).map((row) => row.name));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [orgId, leadNames]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = inviteEmailProblem(email);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    setSent("");
    try {
      const response = await fetch("/api/team/invite-suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, email: email.trim(), role, note: note.trim() || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as { notified?: number; error?: string };
      if (!response.ok) {
        setError(data.error ?? "That didn't send. Try again.");
        return;
      }
      setSent(suggestionSentMessage(email.trim(), data.notified ?? 0));
      setEmail("");
      setNote("");
    } catch {
      setError("Couldn't reach Vantage. Your note is still here. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const titleId = `suggest-invite-${orgId}`;
  return (
    <section className="team-suggest" aria-labelledby={titleId}>
      <h2 id={titleId}>Want a mentor, coach or parent to join?</h2>
      <p className="app-muted">
        Only the team owner and mentors can invite people. Send them the person&rsquo;s email and they&rsquo;ll get a
        notice to invite them. {leads?.length ? teamLeadsLine(leads) : null}
      </p>
      {sent ? (
        <p role="status" className="app-muted">
          {sent}
        </p>
      ) : null}
      {!open ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          Ask to invite someone
        </Button>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label>
            <span>Their email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              value={email}
              disabled={busy}
              placeholder="e.g. coach@school.org"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>They would be</span>
            <select value={role} disabled={busy} onChange={(event) => setRole(event.target.value as typeof role)}>
              {(["admin", "scout", "viewer"] as const).map((choice) => (
                <option key={choice} value={choice}>
                  {ROLE_LABELS[choice]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Note (optional)</span>
            <textarea
              rows={2}
              maxLength={280}
              value={note}
              disabled={busy}
              placeholder="e.g. Mr. Lee teaches robotics and wants to help with CAD."
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="team-invite-notice error">
              {error}
            </p>
          ) : null}
          <div className="team-suggest-actions">
            {compact ? (
              <Button variant="secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : null}
            <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send to the owner and mentors"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
