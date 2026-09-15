"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppleQolBoot } from "../../components/apple-qol-boot";
import { VantageLogo } from "../../components/brand";
import { Button } from "../../components/ui";
import type { TeamJoinLinkPreview } from "@vantage/core";
import { joinOneAccountCopy, joinPreviewDetail, joinPreviewHeadline, joinSignInHref } from "../../lib/join/join-flow";
import "../product-styles";
import "../invite/invite-flow.css";

type PreviewResponse = {
  preview?: TeamJoinLinkPreview | null;
  error?: string;
};

export default function JoinClient() {
  const search = useSearchParams();
  const token = search.get("token")?.trim() ?? "";
  const [preview, setPreview] = useState<TeamJoinLinkPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("This join link is missing its token.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/join/preview?token=${encodeURIComponent(token)}`);
        const data = (await response.json()) as PreviewResponse;
        if (cancelled) return;
        if (!response.ok || !data.preview) {
          setPreview(data.preview ?? null);
          setError(data.error ?? "This join link is not valid.");
          return;
        }
        setPreview(data.preview);
        setError("");
        if (data.preview.status !== "open") return;
        const joined = await fetch("/api/join/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (joined.status === 401) {
          setNeedsSignIn(true);
          return;
        }
        if (joined.ok) {
          window.location.href = "/onboarding";
          return;
        }
        const fail = (await joined.json()) as { error?: string };
        setNeedsSignIn(false);
        setError(fail.error ?? "Could not join this team.");
      } catch {
        if (!cancelled) setError("Could not load this join link.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/join/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = joinSignInHref(token);
          return;
        }
        setError(data.error ?? "Could not join this team.");
        return;
      }
      window.location.href = "/onboarding";
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const open = preview?.status === "open";

  return (
    <main className="onboarding-page invite-flow-page">
      <AppleQolBoot />
      <section className="onboarding-card invite-flow-card">
        <header className="invite-flow-header">
          <VantageLogo />
          <span>TEAM JOIN LINK</span>
          <h1>{joinPreviewHeadline(preview)}</h1>
          <p className="onboarding-sub">{joinPreviewDetail(preview)}</p>
          <p className="onboarding-sub">{joinOneAccountCopy()}</p>
        </header>
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        {open ? (
          <div className="invite-next-actions">
            <Button as="a" variant="primary" href={joinSignInHref(token)}>
              Sign in with Google or email
            </Button>
            {needsSignIn ? null : (
              <Button variant="secondary" type="button" disabled={busy} onClick={() => void accept()}>
                {busy ? "Joining…" : `Join ${preview?.orgName ?? "this team"}`}
              </Button>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
