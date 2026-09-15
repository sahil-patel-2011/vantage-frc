"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Panel } from "../../components/ui";
import type { TeamJoinLinkRecord } from "@vantage/core";

export function TeamAdminJoinLinkPanel({ orgId }: { orgId: string }) {
  const [links, setLinks] = useState<TeamJoinLinkRecord[]>([]);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/team/join-links?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as { links?: TeamJoinLinkRecord[]; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not load join links.");
      return;
    }
    setLinks(data.links ?? []);
    setError("");
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLink() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/team/join-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "create", maxUses: 50, memberRole: "scout" }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not create a join link.");
        return;
      }
      setFreshUrl(data.url ?? null);
      await load();
    } catch {
      setError("Network error — join link was not created.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch("/api/team/join-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "revoke", id }),
      });
      setFreshUrl(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const active = links.find((link) => !link.revokedAt && link.remaining > 0);

  return (
    <Panel className="team-invite-ledger" id="join-link">
      <span className="eyebrow">OPEN JOIN LINK</span>
      <h2>Share one link with the whole team</h2>
      <p>
        Coaches and mentors can send this to anyone — up to 50 people. Each person signs in with Google or
        an email code (same email = one account) and lands on this team.
      </p>
      {error ? (
        <p className="team-invite-notice danger" role="alert">
          {error}
        </p>
      ) : null}
      {freshUrl ? (
        <p className="team-invite-notice info" role="status">
          Copy this now — Vantage only shows the full link once.
          <br />
          <code>{freshUrl}</code>
        </p>
      ) : null}
      <div className="team-invite-row-actions">
        <Button variant="primary" type="button" disabled={busy} onClick={() => void createLink()}>
          {busy ? "Working…" : active ? "Make a new join link" : "Create join link"}
        </Button>
        {freshUrl ? (
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(freshUrl);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        ) : null}
      </div>
      {!links.length ? (
        <EmptyState
          soft
          badge="Empty"
          title="No join link yet"
          description="Create one link and send it in chat, email, or a QR code. Exact-email invites still work for one person."
        />
      ) : (
        <ul className="kick-list">
          {links.map((link) => (
            <li key={link.id}>
              <strong>
                {link.remaining} of {link.maxUses} spots · {link.memberRole}
              </strong>
              <div className="app-muted">
                {link.revokedAt
                  ? "Turned off"
                  : `Expires ${new Date(link.expiresAt).toLocaleDateString()}`}
              </div>
              {!link.revokedAt ? (
                <button type="button" className="kick-link danger" disabled={busy} onClick={() => void revoke(link.id)}>
                  Turn off
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
