"use client";

import { type FormEvent } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { formatInviteRowMeta, inviteDeliveryBanner } from "../../lib/team/team-invites";
import type { AdminTenure, Invite, InviteNotice } from "./team-admin-model";

export function TeamAdminInvitesPanel({
  adminTenure,
  deliveryBanner,
  email,
  setEmail,
  role,
  setRole,
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
  adminTenure: AdminTenure | null;
  deliveryBanner: ReturnType<typeof inviteDeliveryBanner>;
  email: string;
  setEmail: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  inviteBusy: boolean;
  inviteNotice: InviteNotice | null;
  invites: Invite[];
  inviteLinks: Record<string, string>;
  copiedInviteId: string | null;
  actingInviteId: string | null;
  onSend: (event: FormEvent) => void;
  onCopyLink: (id: string, url: string) => void;
  onAct: (inviteId: string, action: "resend" | "revoke") => void;
}) {
  return (
    <section className="admin-grid team-invite-grid" id="invite-form">
      <form className="team-invite-form" onSubmit={onSend}>
        <span className="eyebrow">INVITE BY EMAIL</span>
        <h2>Add a teammate</h2>
        <p>
          Send an invite to one email. They sign in with that address and accept the link. Team
          numbers never grant access.
        </p>
        {adminTenure?.inviteHint ? (
          <p className="app-muted team-admin-tenure-hint" role="note">
            {adminTenure.inviteHint}
          </p>
        ) : null}
        {deliveryBanner ? (
          <p
            className={`team-invite-banner ${deliveryBanner.tone === "setup" ? "setup" : "info"}`}
            role="note"
          >
            <strong>{deliveryBanner.title}</strong>
            <span>{deliveryBanner.detail}</span>
          </p>
        ) : null}
        <label>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="scout">Scout</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <button className="primary-action" type="submit" disabled={inviteBusy}>
          {inviteBusy ? "Sending…" : "Send invite"}
        </button>
        {inviteNotice ? (
          <p className={`team-invite-notice ${inviteNotice.tone}`} role="status">
            {inviteNotice.message}
          </p>
        ) : null}
      </form>
      <Panel className="invite-list team-invite-ledger" id="invitation-ledger">
        <span className="eyebrow">Pending and past invites</span>
        {!invites.length ? (
          <EmptyState
            soft
            badge="No invitations yet"
            badgeTone="setup"
            title="No invites sent yet"
            description="Send an email on the left. You will get a copyable link even if email is not configured."
          />
        ) : (
          invites.map((inviteRow) => {
            const link = inviteLinks[inviteRow.id];
            const pending = inviteRow.status === "pending";
            return (
              <article key={inviteRow.id} className={pending ? "pending" : undefined}>
                <div>
                  <strong>{inviteRow.email}</strong>
                  <small>{formatInviteRowMeta(inviteRow)}</small>
                </div>
                <time>
                  {inviteRow.acceptedAt
                    ? `Accepted ${new Date(inviteRow.acceptedAt).toLocaleDateString()}`
                    : `Expires ${new Date(inviteRow.expiresAt).toLocaleString()}`}
                </time>
                {pending ? (
                  <div className="team-invite-row-actions">
                    {link ? (
                      <button
                        type="button"
                        onClick={() => void onCopyLink(inviteRow.id, link)}
                      >
                        {copiedInviteId === inviteRow.id ? "Copied" : "Copy link"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={actingInviteId === inviteRow.id}
                      onClick={() => void onAct(inviteRow.id, "resend")}
                    >
                      {actingInviteId === inviteRow.id ? "Working…" : link ? "Resend" : "Resend & copy link"}
                    </button>
                    <button
                      type="button"
                      disabled={actingInviteId === inviteRow.id}
                      onClick={() => void onAct(inviteRow.id, "revoke")}
                    >
                      Revoke
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </Panel>
    </section>
  );
}
