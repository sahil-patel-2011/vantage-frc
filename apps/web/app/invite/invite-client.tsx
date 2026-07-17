"use client";

import { useEffect, useState } from "react";

export const PENDING_INVITE_KEY = "vantage.pendingInviteToken";

export default function InviteClient({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) {
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, token);
      } catch {
        // sessionStorage unavailable — user can still accept from this page
      }
    }
  }, [token]);

  async function accept() {
    const inviteToken = token || sessionStorage.getItem(PENDING_INVITE_KEY) || "";
    if (!inviteToken) {
      setMessage("This invitation link is incomplete.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });
      const data = (await response.json()) as { orgId?: string; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not accept invitation.");
        return;
      }
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        // ignore
      }
      const destination = data.orgId
        ? `/workspace?orgId=${encodeURIComponent(data.orgId)}`
        : "/dashboard";
      window.location.assign(destination);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">VANTAGE / TEAM INVITE</span>
        <h1>Accept your invitation</h1>
        <p>Sign in using the exact verified email address that received this invite.</p>
        <button className="primary-action" disabled={busy} onClick={() => void accept()}>
          {busy ? "Accepting…" : "Accept invitation"}
        </button>
        {!token && <p className="auth-message">This invitation link is incomplete.</p>}
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
