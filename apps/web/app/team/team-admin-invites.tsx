"use client";

import { type FormEvent, type RefObject } from "react";
import { Panel, Button } from "../../components/ui";
import { formatInviteRowMeta, inviteDeliveryBanner } from "../../lib/team/team-invites";
import type { Invite, InviteNotice } from "./team-admin-model";

function expiryWords(expiresAt: string): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  // The date, the way the owner invite from platform admin reads ("expires Oct 1").
  return `expires ${new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * Invite form first, then only the invites still waiting. Accepted, revoked
 * and expired ones fold into "Past invites" so the live one isn't buried.
 */
export function TeamAdminInvitesPanel({
  deliveryBanner,
  emailOff,
  tip,
  email,
  setEmail,
  role,
  setRole,
  emailRef,
  inviteBusy,
  inviteNotice,
  invites,
  inviteLinks,
  copiedInviteId,
  actingInviteId,
  onSend,
  onCopyLink,
  onAct,
}: {
  deliveryBanner: ReturnType<typeof inviteDeliveryBanner>;
  /** No email goes out from here: the buttons say "Create" and there is nothing to resend. */
  emailOff: boolean;
  tip: string | null;
  email: string;
  setEmail: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  emailRef: RefObject<HTMLInputElement | null>;
  inviteBusy: boolean;
  inviteNotice: InviteNotice | null;
  invites: Invite[];
  inviteLinks: Record<string, string>;
  copiedInviteId: string | null;
  actingInviteId: string | null;
  onSend: (event: FormEvent) => void;
  onCopyLink: (id: string, url: string) => void;
  onAct: (inviteId: string, action: "resend" | "revoke" | "copy") => void;
}) {
  const pending = invites.filter((invite) => invite.status === "pending");
  // The accepted owner invite is how the team was set up, not someone the team invited.
  const past = invites.filter(
    (invite) => invite.status !== "pending" && !(invite.status === "accepted" && invite.role === "owner"),
  );
  const noticeLink = inviteNotice?.link ? inviteNotice.link : null;
  return (
    <section className="team-invite-section" id="invite" aria-labelledby="invite-title">
      <form className="team-invite-form" id="invite-form" onSubmit={onSend}>
        <h2 id="invite-title">Invite someone</h2>
        <p className="app-muted">
          They join your team when they sign in with this email. People without an invite go to the waitlist.
        </p>
        <div className="team-invite-fields">
          <label>
            Email
            <input
              ref={emailRef}
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. teammate@example.com"
            />
          </label>
          <label>
            They are a
            {/* The words people use. Underneath: scout, admin and viewer team roles. */}
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="scout">Student</option>
              <option value="admin">Mentor or coach</option>
              <option value="viewer">Parent or guest</option>
            </select>
            {/* The dropdown did not say what each choice can do, and "Mentor" is an admin. */}
            <small className="app-muted">
              {role === "admin"
                ? "Scouts and uses team tools. Can also invite and remove people, change team settings and add AI keys."
                : role === "viewer"
                  ? "Can look, can't change."
                  : "Scouts and uses team tools."}
            </small>
          </label>
          <Button variant="primary" type="submit" disabled={inviteBusy}>
            {inviteBusy ? (emailOff ? "Creating…" : "Sending…") : emailOff ? "Create invite" : "Send invite"}
          </Button>
        </div>
        {deliveryBanner && !inviteNotice ? (
          <p className="app-muted team-invite-delivery" role="note">
            {deliveryBanner.title}. {deliveryBanner.detail}
          </p>
        ) : null}
        {tip ? (
          <p className="app-muted team-admin-tenure-hint" role="note">
            {tip}
          </p>
        ) : null}
        {inviteNotice ? (
          <div className={`team-invite-notice ${inviteNotice.tone}`} role="status">
            <span>{inviteNotice.message}</span>
            {noticeLink ? (
              <Button variant="secondary" type="button" onClick={() => onCopyLink(noticeLink.id, noticeLink.url)}>
                {copiedInviteId === noticeLink.id ? "Copied" : "Copy link"}
              </Button>
            ) : null}
            {inviteNotice.undo ? (
              <Button variant="secondary" type="button" onClick={inviteNotice.undo.run}>
                {inviteNotice.undo.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>

      {pending.length ? (
        <Panel className="invite-list team-invite-ledger" id="invitation-ledger">
          <h3>Waiting to join ({pending.length})</h3>
          {pending.map((inviteRow) => {
            const link = inviteLinks[inviteRow.id];
            const acting = actingInviteId === inviteRow.id;
            return (
              <article key={inviteRow.id}>
                <div>
                  <strong>{inviteRow.email}</strong>
                  <small>
                    {formatInviteRowMeta(inviteRow).split(" · ")[0]} · {expiryWords(inviteRow.expiresAt)}
                  </small>
                </div>
                {/* One button set on every waiting invite. Each names its person for screen readers. */}
                <div className="team-invite-row-actions">
                  <button
                    type="button"
                    aria-label={`Copy the invite link for ${inviteRow.email}`}
                    title={link ? undefined : emailOff ? "Makes a fresh link" : "Makes a fresh link (and sends the email again)"}
                    disabled={acting}
                    onClick={() => (link ? onCopyLink(inviteRow.id, link) : onAct(inviteRow.id, "copy"))}
                  >
                    {copiedInviteId === inviteRow.id ? "Copied" : "Copy link"}
                  </button>
                  {emailOff ? null : (
                    <button
                      type="button"
                      aria-label={`Resend the invite to ${inviteRow.email}`}
                      disabled={acting}
                      onClick={() => onAct(inviteRow.id, "resend")}
                    >
                      {acting ? "Working…" : "Resend"}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Revoke the invite to ${inviteRow.email}`}
                    disabled={acting}
                    onClick={() => onAct(inviteRow.id, "revoke")}
                  >
                    Revoke
                  </button>
                </div>
              </article>
            );
          })}
        </Panel>
      ) : null}

      {past.length ? (
        <details className="team-invite-past">
          <summary>Past invites ({past.length})</summary>
          <div className="invite-list">
            {past.map((inviteRow) => (
              <article key={inviteRow.id}>
                <div>
                  <strong>{inviteRow.email}</strong>
                  <small>
                    {formatInviteRowMeta(inviteRow)}
                    {inviteRow.acceptedAt ? ` · joined ${new Date(inviteRow.acceptedAt).toLocaleDateString()}` : ""}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
