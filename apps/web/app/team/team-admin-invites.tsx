"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { INVITE_LIFETIME_CHOICES } from "@vantage/core/invite-policy";
import { ROLE_HINTS, ROLE_LABELS } from "@vantage/core/role-words";
import { Panel, Button } from "../../components/ui";
import {
  formatInviteRowMeta,
  inviteDeliveryBanner,
  inviteExpiryWords,
  inviteLinkButtonLabels,
} from "../../lib/team/team-invites";
import type { Invite, InviteNotice } from "./team-admin-model";

/** The invite form's access choices: Student first (the usual one), Mentor or coach for owners. */
const INVITE_ROLES = ["scout", "admin", "viewer"] as const;

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
  lifetimeHours,
  setLifetimeHours,
  canInviteMentor,
  roleKnown,
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
  onOpenMember,
}: {
  deliveryBanner: ReturnType<typeof inviteDeliveryBanner>;
  /** No email goes out from here: the buttons say "Create" and there is nothing to resend. */
  emailOff: boolean;
  tip: string | null;
  email: string;
  setEmail: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  /** How long the link works, in hours (1, 3 or 7 days). */
  lifetimeHours: number;
  setLifetimeHours: (value: number) => void;
  /** Only the owner invites a mentor or coach (the API says so too). */
  canInviteMentor: boolean;
  /** False until we know who is looking: "only the owner can…" is never said to the owner. */
  roleKnown: boolean;
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
  /** "Change their access" on an already-member notice. */
  onOpenMember?: (userId: string) => void;
}) {
  // A new link kills the one already sent, so it takes a second tap that says so.
  const [confirmNewLink, setConfirmNewLink] = useState<string | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);
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
          They join when they verify this email. You can also share your team’s join code below.
        </p>
        {tip ? <p className="app-muted team-admin-tenure-hint" role="note">{tip}</p> : null}
        <div className="team-invite-fields has-lifetime">
          <label>
            Email
            {/* Text, not type="email": a pasted list of addresses is fine here (one invite each),
                and the browser's own check rejected the comma with a raw message. */}
            <input
              ref={emailRef}
              aria-label="Email"
              aria-describedby="team-invite-email-help"
              required
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (!/[\r\n]/.test(text)) return;
                // A column pasted from a spreadsheet keeps its line breaks as commas.
                e.preventDefault();
                const joined = text.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).join(", ");
                setEmail(email.trim() ? `${email.trim()}, ${joined}` : joined);
              }}
              placeholder="e.g. teammate@example.com"
            />
            <small className="app-muted" id="team-invite-email-help">To invite several people, separate their emails with commas.</small>
          </label>
          <label>
            Team access
            {/* The role words every screen uses (@vantage/core/role-words). Underneath: the
                scout, admin and viewer team roles. */}
            <select value={role} aria-label="Team access" aria-describedby="team-invite-access-help" onChange={(e) => setRole(e.target.value)}>
              {INVITE_ROLES.filter((choice) => choice !== "admin" || canInviteMentor).map((choice) => (
                <option key={choice} value={choice}>
                  {ROLE_LABELS[choice]}
                </option>
              ))}
            </select>
            {/* The dropdown did not say what each choice can do. */}
            <small className="app-muted" id="team-invite-access-help">
              {ROLE_HINTS[role as keyof typeof ROLE_HINTS] ?? ""}
              {roleKnown && !canInviteMentor ? " Only the owner can invite a mentor or coach." : ""}
            </small>
          </label>
          <label>
            Link works for
            <select
              value={lifetimeHours}
              aria-label="Link works for"
              onChange={(e) => setLifetimeHours(Number(e.target.value))}
            >
              {INVITE_LIFETIME_CHOICES.map((choice) => (
                <option key={choice.hours} value={choice.hours}>
                  {choice.label}
                </option>
              ))}
            </select>
            <small className="app-muted">Longer is easier for families; shorter is safer.</small>
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
            {inviteNotice.memberUserId && onOpenMember ? (
              <Button variant="secondary" type="button" onClick={() => onOpenMember(inviteNotice.memberUserId!)}>
                Change their access
              </Button>
            ) : null}
            {inviteNotice.links?.length ? (
              <div className="team-invite-bulk">
                <ul>
                  {inviteNotice.links.map((row) => (
                    <li key={row.id}>
                      <span>{row.email}</span>
                      <Button variant="secondary" size="sm" type="button" onClick={() => onCopyLink(row.id, row.url)}>
                        {copiedInviteId === row.id ? "Copied" : "Copy link"}
                      </Button>
                    </li>
                  ))}
                </ul>
                {inviteNotice.links.length > 1 ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() =>
                      onCopyLink(
                        "all",
                        inviteNotice.links!.map((row) => `${row.email}: ${row.url}`).join("\n"),
                      )
                    }
                  >
                    {copiedInviteId === "all" ? "Copied" : "Copy all links"}
                  </Button>
                ) : null}
              </div>
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
            const linkButton = inviteLinkButtonLabels({
              email: inviteRow.email,
              hasLink: Boolean(link),
              copied: copiedInviteId === inviteRow.id,
              confirmingNewLink: confirmNewLink === inviteRow.id,
            });
            return (
              <article key={inviteRow.id}>
                <div>
                  <strong>{inviteRow.email}</strong>
                  <small>
                    {formatInviteRowMeta(inviteRow).split(" · ")[0]} · {inviteExpiryWords(inviteRow.expiresAt)}
                  </small>
                </div>
                {/* One button set on every waiting invite. Each names its person for screen readers. */}
                <div className="team-invite-row-actions">
                  <button
                    type="button"
                    aria-label={linkButton.accessibleName}
                    title={
                      link
                        ? undefined
                        : `Makes a new link${emailOff ? "" : " and emails it"}. The link you sent before stops working.`
                    }
                    disabled={acting}
                    onClick={() => {
                      if (link) return onCopyLink(inviteRow.id, link);
                      if (confirmNewLink !== inviteRow.id) return setConfirmNewLink(inviteRow.id);
                      setConfirmNewLink(null);
                      onAct(inviteRow.id, "copy");
                    }}
                  >
                    {/* Links are kept only as long as this page is open (never stored in plain text), so
                        after a reload the button makes a new one, and asks first. */}
                    {linkButton.label}
                  </button>
                  {emailOff ? null : (
                    <button
                      type="button"
                      aria-label={acting ? `Working… on the invite to ${inviteRow.email}` : `Resend the invite to ${inviteRow.email}`}
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
            {/* The newest ten; the list had no end (42 revoked test addresses, 3,800px). */}
            {(showAllPast ? past : past.slice(0, 10)).map((inviteRow) => (
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
            {past.length > 10 && !showAllPast ? (
              <button type="button" className="text-button" onClick={() => setShowAllPast(true)}>
                Show all {past.length}
              </button>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
