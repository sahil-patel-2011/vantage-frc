"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, askConfirm } from "../../../components/ui";
import { BAN_REASON_LABELS, BAN_REASONS, type BanReason, type TeamBan, type TeamRequest } from "../../../lib/admin/team-governance-model";
import { ReauthHint, SidePanel, StatusPill, api, day } from "../admin-console-kit";
import "../admin-console.css";
import "./team-governance.css";

type Payload = { requests: TeamRequest[]; bans: TeamBan[]; isOwner: boolean };

/** Fired after an approval created a team, so Platform admin › Teams reloads its list. */
export const ADMIN_TEAMS_CHANGED_EVENT = "vantage:admin-teams-changed";
type Message = { text: string; tone?: "error"; code?: string };

const ROLE_WORDS: Record<string, string> = {
  student: "Student",
  mentor: "Mentor or teacher",
  coach: "Head mentor or coach",
  parent: "Parent",
  other: "Something else",
};

const STATUS_WORDS: Record<TeamRequest["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
  forwarded: "Sent to the team's owner",
};

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return day(iso);
}

/**
 * Team requests and banned teams, at the top of Platform admin › Teams.
 *
 * A request is someone asking to put their FRC team on Vantage (or to lead one nobody leads).
 * Approving creates the team with them as owner. Bans are the platform owner's alone.
 */
export function TeamGovernance({ onTeamsChanged }: { onTeamsChanged?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<TeamRequest | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [banOpen, setBanOpen] = useState(false);
  const [ban, setBan] = useState<{ teamNumber: string; reason: BanReason | ""; note: string }>({ teamNumber: "", reason: "", note: "" });

  const load = useCallback(async () => {
    const result = await api<Payload>("/api/admin/team-requests");
    if (result.ok) {
      setData(result.data);
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(request: TeamRequest) {
    const ok = await askConfirm({
      title: `Approve Team ${request.teamNumber}?`,
      body: request.orgId
        ? `${request.requesterName} becomes the owner of Team ${request.teamNumber}, which has nobody leading it yet.`
        : `Vantage creates Team ${request.teamNumber} with ${request.requesterName} as its owner. Anyone else who asked for this team is sent to them.`,
      confirmLabel: "Approve",
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await api<{ teamLabel: string; emailSent: boolean }>("/api/admin/team-requests", {
      method: "POST",
      body: JSON.stringify({ requestId: request.id, decision: "approve" }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setMessage({
      text: `${result.data.teamLabel} is ready. ${request.requesterName} is its owner${result.data.emailSent ? " and has an email" : ""}.`,
    });
    await load();
    onTeamsChanged?.();
    // The team list below belongs to the Teams page: it reloads to show the new team.
    window.dispatchEvent(new Event(ADMIN_TEAMS_CHANGED_EVENT));
  }

  async function submitDecline(event: React.FormEvent) {
    event.preventDefault();
    if (!declining) return;
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/team-requests", {
      method: "POST",
      body: JSON.stringify({ requestId: declining.id, decision: "decline", reason: declineReason }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setMessage({ text: `Declined. ${declining.requesterName} has a note in their inbox.` });
    setDeclining(null);
    setDeclineReason("");
    await load();
  }

  async function submitBan(event: React.FormEvent) {
    event.preventDefault();
    const teamNumber = Number(ban.teamNumber);
    const ok = await askConfirm({
      title: `Ban Team ${teamNumber}?`,
      body: "Nobody can request, create or join this team, and its members lose access until you lift the ban. Nothing is deleted, and members get a note saying why.",
      confirmLabel: "Ban team",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/team-bans", {
      method: "POST",
      body: JSON.stringify({ teamNumber, reason: ban.reason, note: ban.note }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setBanOpen(false);
    setBan({ teamNumber: "", reason: "", note: "" });
    setMessage({ text: `Team ${teamNumber} is banned.` });
    await load();
  }

  async function lift(entry: TeamBan) {
    const ok = await askConfirm({
      title: `Lift the ban on Team ${entry.teamNumber}?`,
      body: "The team can be requested and joined again, and its members get their access back.",
      confirmLabel: "Lift ban",
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/team-bans", {
      method: "DELETE",
      body: JSON.stringify({ teamNumber: entry.teamNumber }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setMessage({ text: `Team ${entry.teamNumber} can use Vantage again.` });
    await load();
  }

  if (loadError) {
    return (
      <p className="ac-message ac-muted" role="status">
        Team requests and bans: {loadError}
      </p>
    );
  }
  if (!data) return null;

  const pending = data.requests.filter((request) => request.status === "pending");
  const handled = data.requests.filter((request) => request.status !== "pending");

  return (
    <div className="tg-stack">
      {message ? (
        <p className="ac-message" data-tone={message.tone} role="status">
          {message.text} <ReauthHint code={message.code} />
        </p>
      ) : null}

      <section className="ac-section tg-section" id="team-requests" aria-labelledby="team-requests-title">
        <div className="ac-section-head">
          <div>
            <h2 id="team-requests-title">
              Team requests{pending.length ? <span className="tg-count">{pending.length}</span> : null}
            </h2>
            <p>People asking to put their FRC team on Vantage, or to lead a team nobody leads yet.</p>
          </div>
        </div>
        {pending.length ? (
          <ul className="ac-list">
            {pending.map((request) => (
              <li key={request.id} className="ac-item tg-request">
                <span className="ac-row-badge">#{request.teamNumber}</span>
                <div className="ac-row-main">
                  <strong>
                    {request.teamName ? `${request.teamName} · ` : ""}
                    {request.orgId ? "Needs an owner" : "New team"}
                  </strong>
                  <small>
                    {request.requesterName} · {request.requesterEmail}
                    {request.requestedTeamRole ? ` · ${ROLE_WORDS[request.requestedTeamRole] ?? request.requestedTeamRole}` : ""}
                    {` · asked ${ago(request.updatedAt)}`}
                  </small>
                  {request.roleDescription ? <q className="tg-quote">{request.roleDescription}</q> : null}
                </div>
                <div className="ac-item-actions tg-actions">
                  <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setDeclining(request)}>
                    Decline…
                  </Button>
                  <Button variant="primary" size="sm" type="button" disabled={busy} onClick={() => void approve(request)}>
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">No requests waiting. New ones also show up in your notifications.</p>
        )}
        {handled.length ? (
          <details className="tg-history">
            <summary data-disclosure>Handled ({handled.length})</summary>
            <ul className="ac-list">
              {handled.map((request) => (
                <li key={request.id} className="ac-item">
                  <span className="ac-row-badge">#{request.teamNumber}</span>
                  <div className="ac-row-main">
                    <strong>{request.requesterName}</strong>
                    <small>
                      {STATUS_WORDS[request.status]}
                      {request.reviewedAt ? ` · ${day(request.reviewedAt)}` : ""}
                      {request.declineReason ? ` · “${request.declineReason}”` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="ac-section tg-section" id="banned-teams" aria-labelledby="banned-teams-title">
        <div className="ac-section-head">
          <div>
            <h2 id="banned-teams-title">Banned teams</h2>
            <p>
              A banned team can&rsquo;t be requested, created or joined, and its members lose access until the ban is
              lifted. Nothing is deleted.
              {data.isOwner ? "" : " Only the platform owner bans teams."}
            </p>
          </div>
          {data.isOwner ? (
            <Button variant="secondary" type="button" onClick={() => setBanOpen(true)}>
              Ban a team…
            </Button>
          ) : null}
        </div>
        {data.bans.length ? (
          <ul className="ac-list">
            {data.bans.map((entry) => (
              <li key={entry.teamNumber} className="ac-item">
                <span className="ac-row-badge">#{entry.teamNumber}</span>
                <div className="ac-row-main">
                  <strong>
                    {entry.orgName ?? `Team ${entry.teamNumber}`} <StatusPill status="down" label="Banned" />
                  </strong>
                  <small>
                    {BAN_REASON_LABELS[entry.reason] ?? entry.reason} · since {day(entry.bannedAt)}
                    {entry.orgName ? ` · ${entry.memberCount} member${entry.memberCount === 1 ? "" : "s"} locked out` : " · not on Vantage"}
                  </small>
                  {entry.note ? <q className="tg-quote">{entry.note}</q> : null}
                </div>
                {data.isOwner ? (
                  <div className="ac-item-actions">
                    <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void lift(entry)}>
                      Lift ban…
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">No teams are banned.</p>
        )}
      </section>

      <SidePanel
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title={declining ? `Decline Team ${declining.teamNumber}?` : "Decline"}
        description="They get a note with your reason. They can fix the number and ask again."
      >
        <form className="ac-form" onSubmit={submitDecline}>
          <label>
            Reason <small>Optional, shown to them</small>
            <textarea
              rows={3}
              maxLength={500}
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder="e.g. Ask your head mentor to request the team."
            />
          </label>
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={() => setDeclining(null)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Decline request"}
            </Button>
          </div>
        </form>
      </SidePanel>

      <SidePanel
        open={banOpen}
        onClose={() => setBanOpen(false)}
        title="Ban a team"
        description="For breaking Vantage's Terms of Service or Privacy Policy. You can lift it any time."
      >
        <form className="ac-form" onSubmit={submitBan}>
          <label>
            FRC team number
            <input
              required
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              value={ban.teamNumber}
              onChange={(event) => setBan({ ...ban, teamNumber: event.target.value.replace(/\D/g, "").slice(0, 5) })}
            />
          </label>
          <label>
            Why
            <select required value={ban.reason} onChange={(event) => setBan({ ...ban, reason: event.target.value as BanReason })}>
              <option value="" disabled>
                Choose a reason
              </option>
              {BAN_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {BAN_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note <small>Optional, only platform admins see it</small>
            <textarea rows={3} maxLength={1000} value={ban.note} onChange={(event) => setBan({ ...ban, note: event.target.value })} />
          </label>
          {message?.tone === "error" ? (
            <p className="ac-message" data-tone="error" role="alert">
              {message.text} <ReauthHint code={message.code} />
            </p>
          ) : null}
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={() => setBanOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" disabled={busy || !ban.teamNumber || !ban.reason}>
              {busy ? "Saving…" : "Ban team…"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
