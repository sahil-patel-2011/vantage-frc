"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";

export const PENDING_INVITE_KEY = "vantage.pendingInviteToken";

type InvitePreview = {
  orgName: string;
  teamNumber: number;
  role: string;
  email: string;
  status: string;
  expiresAt: string;
};

export default function InviteClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) {
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, token);
      } catch {
        // sessionStorage unavailable
      }
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      return;
    }
    let active = true;
    void fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!active) return;
        if (!response.ok) {
          setMessage(data.error ?? "Could not load invitation details.");
          setPreview(null);
          return;
        }
        setPreview(data.preview ?? null);
      })
      .catch(() => {
        if (active) setMessage("Could not load invitation details.");
      });
    return () => {
      active = false;
    };
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

  const loadingPreview = token && preview === undefined;

  return (
    <main className="onboarding-page">
      <section className="onboarding-card" aria-labelledby="invite-title">
        <div className="onboarding-brand">
          <VantageLogo />
        </div>
        <span className="eyebrow">Team invitation</span>
        <h1 id="invite-title">Accept your invitation</h1>
        <p className="onboarding-sub">Sign in with the verified email that received this invite before accepting.</p>

        {loadingPreview ? <p className="onboarding-sub">Loading invitation…</p> : null}

        {preview ? (
          <div className="onboarding-callout invite">
            <strong>
              {preview.orgName} · Team {preview.teamNumber}
            </strong>
            <p>
              Role: {preview.role} · Sent to {preview.email} · Status {preview.status}
              {preview.expiresAt ? ` · Expires ${new Date(preview.expiresAt).toLocaleString()}` : ""}
            </p>
          </div>
        ) : null}

        {!token ? (
          <div className="onboarding-callout">
            <strong>Missing token</strong>
            <p>Open the full invite link from your email, or finish onboarding if you arrived here early.</p>
          </div>
        ) : null}

        <button className="signin-submit" disabled={busy || !token} onClick={() => void accept()}>
          {busy ? "Accepting…" : "Accept invitation"}
        </button>

        {message ? (
          <p className="signin-status" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
