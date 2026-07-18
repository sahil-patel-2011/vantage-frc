"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import { LegalAgreementCheckbox } from "../../components/legal-agreement-checkbox";
import {
  PENDING_INVITE_STORAGE_KEY,
  classifyInviteFlow,
  formatInviteRole,
  formatInviteTeamIdentity,
  inviteCanAccept,
  inviteEmptyCopy,
  inviteNextActions,
  type InviteFlowKind,
  type InvitePreview,
} from "../../lib/invite";
import "./invite-flow.css";

/** Kept for onboarding handoff (`PENDING_INVITE_KEY` import). */
export const PENDING_INVITE_KEY = PENDING_INVITE_STORAGE_KEY;

type PreviewResponse = {
  preview?: InvitePreview | null;
  termsRequired?: boolean;
  error?: string;
};

function badgeClass(kind: InviteFlowKind): string {
  if (kind === "expired" || kind === "revoked" || kind === "email_mismatch") return "warn";
  if (kind === "invalid" || kind === "error") return "danger";
  return "";
}

function NextActions({
  kind,
  orgId,
  token,
}: {
  kind: InviteFlowKind;
  orgId?: string | null;
  token: string;
}) {
  const actions = inviteNextActions({ kind, orgId, token }).filter(
    (action) => action.href !== "#invite-accept",
  );
  if (actions.length === 0) return null;
  return (
    <section className="invite-next-actions" aria-label="Next steps">
      <header>
        <h2>Next steps</h2>
        <p>Closed membership — exact-email invites only. Never DEMO join links.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="signin-link" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function InviteClient() {
  const params = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [termsRequired, setTermsRequired] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    try {
      sessionStorage.setItem(PENDING_INVITE_KEY, token);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      setLoadError(null);
      setAuthRequired(false);
      setEmailMismatch(false);
      return;
    }
    let active = true;
    setPreview(undefined);
    setLoadError(null);
    setAuthRequired(false);
    setEmailMismatch(false);
    void fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = (await response.json()) as PreviewResponse;
        if (!active) return;
        if (response.status === 401) {
          setAuthRequired(true);
          setPreview(null);
          setLoadError(data.error ?? "Sign in required.");
          return;
        }
        if (response.status === 403) {
          setEmailMismatch(true);
          setPreview(null);
          setLoadError(data.error ?? "This invite was sent to a different email address.");
          return;
        }
        if (!response.ok) {
          setPreview(null);
          setLoadError(data.error ?? "Could not load invitation details.");
          return;
        }
        setTermsRequired(data.termsRequired !== false);
        setPreview(data.preview ?? null);
        if (!data.preview) {
          setLoadError(data.error ?? "This invitation is invalid or unavailable.");
        }
      })
      .catch(() => {
        if (active) {
          setPreview(null);
          setLoadError("Could not load invitation details.");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loading =
    Boolean(token) && preview === undefined && !authRequired && !emailMismatch && !loadError;
  const kind = classifyInviteFlow({
    token,
    loading,
    authRequired,
    emailMismatch,
    preview: preview ?? null,
    error: loadError,
  });
  const empty = inviteEmptyCopy(kind, loadError);
  const canAccept = inviteCanAccept({
    termsAccepted: termsRequired ? termsAccepted : true,
    termsRequired,
    status: preview?.status,
  });
  const identity = useMemo(
    () => (preview && kind === "ready" ? formatInviteTeamIdentity(preview) : null),
    [preview, kind],
  );

  async function accept() {
    if (termsRequired && !termsAccepted) {
      setMessageTone("error");
      setMessage("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }
    let inviteToken = token;
    if (!inviteToken) {
      try {
        inviteToken = sessionStorage.getItem(PENDING_INVITE_KEY) || "";
      } catch {
        inviteToken = "";
      }
    }
    if (!inviteToken) {
      setMessageTone("error");
      setMessage("This invitation link is incomplete.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          ...(termsRequired ? { termsAccepted: true as const } : {}),
        }),
      });
      const data = (await response.json()) as { orgId?: string; error?: string };
      if (response.status === 401) {
        setAuthRequired(true);
        setMessageTone("error");
        setMessage(data.error ?? "Sign in with the invited email to accept.");
        return;
      }
      if (response.status === 403) {
        setEmailMismatch(true);
        setMessageTone("error");
        setMessage(data.error ?? "This invite was sent to a different email address.");
        return;
      }
      if (!response.ok) {
        setMessageTone("error");
        setMessage(data.error ?? "Could not accept invitation.");
        return;
      }
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        /* ignore */
      }
      window.location.assign(
        data.orgId ? `/workspace?orgId=${encodeURIComponent(data.orgId)}` : "/dashboard",
      );
    } finally {
      setBusy(false);
    }
  }

  const showReady = kind === "ready" && preview;

  return (
    <main className="onboarding-page invite-flow-page">
      <section className="onboarding-card invite-flow-card" aria-labelledby="invite-title">
        <header className="invite-flow-header">
          <div className="onboarding-brand">
            <VantageLogo />
          </div>
          <span>{empty.eyebrow}</span>
          <h1 id="invite-title">{showReady ? "Join your team workspace" : empty.title}</h1>
          <p className="onboarding-sub">
            {showReady
              ? "Sign in with the verified email that received this invite, accept terms if needed, then join."
              : empty.description}
          </p>
        </header>

        {message ? (
          <p className={`invite-message${messageTone === "error" ? " error" : ""}`} role="status">
            {message}
          </p>
        ) : null}

        {showReady ? (
          <>
            <div className="invite-team-identity" aria-label="Team invitation details">
              <span>TEAM IDENTITY</span>
              <strong>{identity}</strong>
              <div className="invite-team-meta">
                <div>
                  <span>ROLE</span>
                  <strong>{formatInviteRole(preview.role) ?? preview.role}</strong>
                </div>
                <div>
                  <span>SENT TO</span>
                  <strong>{preview.email}</strong>
                </div>
                <div>
                  <span>EXPIRES</span>
                  <strong>{new Date(preview.expiresAt).toLocaleString()}</strong>
                </div>
              </div>
            </div>

            <div className="invite-security-note">
              <b aria-hidden="true">OK</b>
              <p>
                <strong>Exact-email invite security</strong>
                <span>
                  Only the verified account matching {preview.email} can accept. Team numbers never
                  auto-join a workspace.
                </span>
              </p>
            </div>

            {termsRequired ? (
              <LegalAgreementCheckbox
                id="invite-terms"
                checked={termsAccepted}
                onChange={setTermsAccepted}
                className="invite-legal"
              />
            ) : (
              <p className="invite-message" role="status">
                Terms already accepted on this account — you can join without re-checking.
              </p>
            )}

            <div className="invite-actions" id="invite-accept">
              <button
                type="button"
                className="signin-submit"
                disabled={busy || !token || !canAccept}
                onClick={() => void accept()}
              >
                {busy ? "Accepting…" : "Accept invitation"}
              </button>
              <a className="signin-link" href="/workspace">
                Workspace
              </a>
            </div>
          </>
        ) : (
          <div className="invite-empty-shell">
            {empty.badge ? (
              <span className={`invite-empty-badge ${badgeClass(kind)}`.trim()}>{empty.badge}</span>
            ) : null}
            {kind === "auth_required" ? (
              <div className="invite-actions">
                <a
                  className="signin-submit"
                  href={`/signin?next=${encodeURIComponent(token ? `/invite?token=${encodeURIComponent(token)}` : "/invite")}`}
                  style={{ display: "inline-flex", textDecoration: "none", width: "auto" }}
                >
                  Sign in to continue
                </a>
              </div>
            ) : null}
            {kind === "email_mismatch" ? (
              <div className="invite-security-note">
                <b aria-hidden="true">!</b>
                <p>
                  <strong>Wrong account for this invite</strong>
                  <span>
                    Sign out, then sign in with the exact address on the invitation. Preview details
                    stay hidden on mismatch.
                  </span>
                </p>
              </div>
            ) : null}
            {kind === "loading" ? <p className="onboarding-sub">Checking invite…</p> : null}
          </div>
        )}

        <NextActions kind={kind} orgId={preview?.orgId} token={token} />
      </section>
    </main>
  );
}
