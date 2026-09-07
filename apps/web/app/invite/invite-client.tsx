"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  inviteSignInHref,
  type InviteFlowKind,
  type InvitePreview,
} from "../../lib/invite";
import { legalConsentMessage } from "../../lib/legal";
import { signOutAndRedirect } from "../../lib/sign-out";
import "./invite-flow.css";

/** Kept for onboarding handoff (`PENDING_INVITE_KEY` import). */
export const PENDING_INVITE_KEY = PENDING_INVITE_STORAGE_KEY;

type PreviewResponse = {
  preview?: InvitePreview | null;
  legalRequired?: boolean;
  signedIn?: boolean;
  emailMismatch?: boolean;
  sessionEmail?: string | null;
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
  const actions = inviteNextActions({ kind, orgId, token });
  if (actions.length === 0) return null;
  return (
    <section className="invite-next-actions" aria-label="Next steps">
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="signin-link" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InviteIdentity({ preview }: { preview: InvitePreview }) {
  return (
    <div className="invite-team-identity" aria-label="Team invitation details">
      <span>TEAM</span>
      <strong>{formatInviteTeamIdentity(preview)}</strong>
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
  );
}

export default function InviteClient() {
  const params = useSearchParams();
  const urlToken = params.get("token")?.trim() ?? "";
  // `proxy.ts` builds its sign-in / second-factor bounce from `pathname` alone,
  // so a user can come back to a bare `/invite`. The token we stashed on the
  // first visit is what keeps that from reading as "link incomplete".
  const [recoveredToken, setRecoveredToken] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(!urlToken);
  const token = urlToken || recoveredToken || "";
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [legalRequired, setLegalRequired] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (urlToken) {
      setRecovering(false);
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, urlToken);
      } catch {
        /* sessionStorage unavailable */
      }
      return;
    }
    let stashed: string;
    try {
      stashed = sessionStorage.getItem(PENDING_INVITE_KEY)?.trim() ?? "";
    } catch {
      stashed = "";
    }
    setRecoveredToken(stashed || null);
    setRecovering(false);
    if (stashed) {
      // Put the token back in the address bar so a refresh or a shared tab
      // keeps working. `replaceState` leaves no extra history entry.
      try {
        window.history.replaceState(null, "", `/invite?token=${encodeURIComponent(stashed)}`);
      } catch {
        /* history unavailable */
      }
    }
  }, [urlToken]);

  useEffect(() => {
    if (recovering) return;
    if (!token) {
      setPreview(null);
      setLoadError(null);
      setAuthRequired(false);
      setEmailMismatch(false);
      setSessionEmail(null);
      return;
    }
    let active = true;
    setPreview(undefined);
    setLoadError(null);
    setAuthRequired(false);
    setEmailMismatch(false);
    setSessionEmail(null);
    void fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = (await response.json()) as PreviewResponse;
        if (!active) return;
        setSessionEmail(data.sessionEmail ?? null);
        setLegalRequired(data.legalRequired !== false);
        if (response.status === 401) {
          setAuthRequired(true);
          setPreview(data.preview ?? null);
          setLoadError(data.error ?? "Sign in required.");
          return;
        }
        if (response.status === 404) {
          setPreview(null);
          return;
        }
        if (!response.ok && response.status !== 403) {
          setPreview(data.preview ?? null);
          setLoadError(data.error ?? "Could not load invitation details.");
          return;
        }
        const nextPreview = data.preview ?? null;
        setPreview(nextPreview);
        const mismatch = Boolean(data.emailMismatch) || response.status === 403;
        setEmailMismatch(mismatch);
        setAuthRequired(data.signedIn === false && Boolean(nextPreview) && !mismatch);
        if (!nextPreview) {
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
  }, [token, recovering]);

  const loading =
    recovering ||
    (Boolean(token) && preview === undefined && !authRequired && !emailMismatch && !loadError);
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
    termsAccepted,
    privacyAccepted,
    legalRequired,
    status: preview?.status,
  });
  const identityPreview =
    preview && (kind === "ready" || kind === "auth_required" || kind === "email_mismatch")
      ? preview
      : null;
  const identity = useMemo(
    () => (identityPreview ? formatInviteTeamIdentity(identityPreview) : null),
    [identityPreview],
  );

  /**
   * Coming back from sign-in, the acceptance button is the only thing left to
   * do — put focus on it rather than making the user hunt down the page.
   */
  useEffect(() => {
    if (kind !== "ready") return;
    const frame = window.requestAnimationFrame(() => acceptRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [kind]);

  async function accept() {
    if (legalRequired && !(termsAccepted && privacyAccepted)) {
      const consentMessage =
        legalConsentMessage({ terms: termsAccepted, privacy: privacyAccepted }) ??
        "Agree to the Terms of Service and the Privacy Policy.";
      setLegalError(consentMessage);
      setMessageTone("error");
      setMessage(consentMessage);
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
          ...(legalRequired ? { termsAccepted: true as const, privacyAccepted: true as const } : {}),
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
          {empty.badge && !showReady ? (
            <span className={`invite-empty-badge ${badgeClass(kind)}`.trim()}>{empty.badge}</span>
          ) : null}
          <span>{empty.eyebrow}</span>
          <h1 id="invite-title">{showReady ? "Join your team" : empty.title}</h1>
          <p className="onboarding-sub">
            {showReady
              ? identity
                ? `Join ${identity} with ${preview.email}.`
                : "Accept this invite with the email it was sent to."
              : empty.description}
          </p>
        </header>

        {message ? (
          <p className={`invite-message${messageTone === "error" ? " error" : ""}`} role="status">
            {message}
          </p>
        ) : null}

        {identityPreview ? <InviteIdentity preview={identityPreview} /> : null}

        {showReady ? (
          <>
            {legalRequired ? (
              <LegalAgreementCheckbox
                id="invite-legal"
                terms={termsAccepted}
                privacy={privacyAccepted}
                onChange={(next) => {
                  setTermsAccepted(next.terms);
                  setPrivacyAccepted(next.privacy);
                  setLegalError(legalConsentMessage({ terms: next.terms, privacy: next.privacy }));
                }}
                className="invite-legal"
                disabled={busy}
                error={legalError}
              />
            ) : null}

            <div className="invite-actions" id="invite-accept">
              <button
                ref={acceptRef}
                type="button"
                className="signin-submit"
                disabled={busy || !token || !canAccept}
                onClick={() => void accept()}
              >
                {busy ? "Joining…" : "Accept invitation"}
              </button>
            </div>
          </>
        ) : (
          <div className="invite-empty-shell">
            {kind === "auth_required" ? (
              <div className="invite-actions">
                <a className="signin-submit" href={inviteSignInHref(token)}>
                  Sign in to accept
                </a>
              </div>
            ) : null}
            {kind === "email_mismatch" ? (
              <>
                <div className="invite-security-note">
                  <b aria-hidden="true">!</b>
                  <p>
                    <strong>Wrong account for this invite</strong>
                    <span>
                      You are signed in as {sessionEmail || "a different email"}. This invite is for{" "}
                      {preview?.email || "another address"}.
                    </span>
                  </p>
                </div>
                <div className="invite-actions">
                  <button
                    type="button"
                    className="signin-submit"
                    disabled={busy}
                    onClick={() => void signOutAndRedirect(inviteSignInHref(token))}
                  >
                    Sign out and switch accounts
                  </button>
                </div>
              </>
            ) : null}
            {kind === "loading" ? <p className="onboarding-sub">Checking invite…</p> : null}
          </div>
        )}

        {kind !== "ready" && kind !== "auth_required" && kind !== "email_mismatch" ? (
          <NextActions kind={kind} orgId={preview?.orgId} token={token} />
        ) : null}
      </section>
    </main>
  );
}
