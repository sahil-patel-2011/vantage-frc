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
import { inviteAcceptanceFailure } from "../../lib/invite/accept-error";
import "./invite-flow.css";

/** Kept for onboarding handoff (`PENDING_INVITE_KEY` import). */
export const PENDING_INVITE_KEY = PENDING_INVITE_STORAGE_KEY;

type PreviewResponse = {
  preview?: InvitePreview | null;
  legalRequired?: boolean;
  profileRequired?: boolean;
  passwordRequired?: boolean;
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
              {/* The action's own name is the link; a row of "Open" links said nothing. */}
              <a className="invite-next-link" href={action.href}>
                {action.label}
              </a>
              <span>{action.detail}</span>
            </div>
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
      {/* The role has its own line just below; the team line said it too. */}
      <strong>{formatInviteTeamIdentity({ ...preview, role: "" })}</strong>
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
          <strong><time dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></strong>
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
  const currentToken = useRef(token);
  currentToken.current = token;
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [legalRequired, setLegalRequired] = useState(true);
  const [profileRequired, setProfileRequired] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const passwordRequest = useRef(false);
  const acceptRequest = useRef(false);
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
    setProfileRequired(false);
    setMessage("");
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    setLegalError(null);
    setPasswordRequired(false);
    setPassword("");
    setPasswordConfirmation("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as PreviewResponse;
        if (!active) return;
        setLoadedToken(token);
        setSessionEmail(data.sessionEmail ?? null);
        setLegalRequired(data.legalRequired !== false);
        setProfileRequired(data.profileRequired === true);
        setPasswordRequired(data.passwordRequired === true);
        if (response.status === 401) {
          setAuthRequired(true);
          setPreview(data.preview ?? null);
          setLoadError(data.error ?? "Sign in required.");
          return;
        }
        // A mistyped or cut-off link is not a network problem: show "doesn't work", not Retry.
        if (response.status === 404 || response.status === 400) {
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
          setLoadedToken(token);
          setPreview(null);
          setLoadError("Could not load invitation details.");
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [token, recovering]);

  const loading =
    recovering ||
    (Boolean(token) && (loadedToken !== token || (preview === undefined && !loadError)));
  const kind = classifyInviteFlow({
    token,
    loading,
    authRequired,
    emailMismatch,
    preview: preview ?? null,
    error: loadError,
  });
  const empty = inviteEmptyCopy(kind, loadError);
  const canAccept = !profileRequired && inviteCanAccept({
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
    if (acceptRequest.current || passwordRequest.current) return;
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
      setMessage("No invite is open. Open the full link from your email.");
      return;
    }
    acceptRequest.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          ...(legalRequired ? { termsAccepted: true as const, privacyAccepted: true as const } : {}),
        }),
      });
      const data = (await response.json()) as { orgId?: string; error?: string; code?: string };
      if (currentToken.current !== inviteToken) return;
      if (!response.ok) {
        const failure = inviteAcceptanceFailure(response.status, data);
        if (failure.kind === "auth_required") setAuthRequired(true);
        if (failure.kind === "email_mismatch") setEmailMismatch(true);
        if (failure.kind === "profile_required") setProfileRequired(true);
        setMessageTone("error");
        setMessage(failure.message);
        return;
      }
      if (!data.orgId) throw new Error("The team could not be confirmed.");
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        /* ignore */
      }
      // Home, on the team just joined — where the first-week steps are. The
      // workspace page is a competition console; a new member landed on
      // "Vantage Agent" and "CAD Agent" cards instead of what to do first.
      window.location.assign(
        data.orgId ? `/dashboard?orgId=${encodeURIComponent(data.orgId)}` : "/dashboard",
      );
    } catch {
      if (currentToken.current !== inviteToken) return;
      setMessageTone("error");
      setMessage("Could not confirm that you joined. Check your teams before retrying this invitation.");
    } finally {
      acceptRequest.current = false;
      setBusy(false);
    }
  }

  async function setInvitePassword() {
    if (passwordRequest.current || acceptRequest.current || !canAccept || password.length < 12 || password !== passwordConfirmation) return;
    passwordRequest.current = true;
    setPasswordBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/invites/password", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json() as { passwordSet?: boolean; alreadySet?: boolean; error?: string };
      if (currentToken.current !== token) return;
      if (!response.ok || data.passwordSet !== true) {
        if (response.status === 401) setAuthRequired(true);
        setMessageTone("error");
        setMessage(data.error ?? "Could not set your password. Try again.");
        return;
      }
      setPasswordRequired(false);
      setPassword("");
      setPasswordConfirmation("");
      setMessageTone("info");
      if (data.alreadySet) {
        setMessage("Your account already has a password, so it was kept. Accept your invitation to join the team.");
        return;
      }
      setMessage("Password saved. Joining your team…");
      passwordRequest.current = false;
      await accept();
    } catch {
      if (currentToken.current !== token) return;
      setMessageTone("error");
      setMessage("Could not confirm your password was saved. Retry to check its status, or continue with an email code.");
    } finally {
      passwordRequest.current = false;
      setPasswordBusy(false);
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

        {profileRequired ? (
          <p><a className="invite-next-link" href={`/onboarding?next=${encodeURIComponent(`/invite?token=${token}`)}`}>
            Finish your profile
          </a> to confirm age eligibility. Your invitation stays available.</p>
        ) : null}

        {identityPreview ? <InviteIdentity preview={identityPreview} /> : null}
        {!token ? <p><a className="invite-next-link" href="/join-team">Join with a team code</a></p> : null}

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
                disabled={busy || passwordBusy}
                error={legalError}
              />
            ) : null}

            {passwordRequired ? <form className="invite-password-form" onSubmit={event => { event.preventDefault(); void setInvitePassword(); }}>
              <h2>Set your password</h2>
              <p>Use at least 12 characters. Your password belongs to your account; each team controls which sign-in methods it allows.</p>
              <label htmlFor="invite-password">Password</label>
              <input id="invite-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy || passwordBusy} value={password} onChange={event => setPassword(event.target.value)} />
              <label htmlFor="invite-password-confirm">Confirm password</label>
              <input id="invite-password-confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy || passwordBusy} value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} aria-describedby={passwordConfirmation && password !== passwordConfirmation ? "invite-password-match" : undefined} aria-invalid={Boolean(passwordConfirmation && password !== passwordConfirmation)} />
              {passwordConfirmation && password !== passwordConfirmation ? <small id="invite-password-match">Passwords do not match.</small> : null}
              <button className="signin-submit" type="submit" disabled={busy || passwordBusy || !canAccept || password.length < 12 || password !== passwordConfirmation}>{passwordBusy ? "Saving password…" : "Set password and join team"}</button>
            </form> : null}
            <div className="invite-actions" id="invite-accept">
              <button
                ref={acceptRef}
                type="button"
                className="signin-submit"
                disabled={busy || passwordBusy || !token || !canAccept}
                onClick={() => void accept()}
              >
                {busy ? "Joining…" : passwordRequired ? "Continue with email or Google" : "Accept invitation"}
              </button>
            </div>
          </>
        ) : kind === "auth_required" || kind === "email_mismatch" || kind === "loading" ? (
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
        ) : null}

        {/* Not while loading: "Retry invitation" sat under "Checking invite…" on every normal open. */}
        {kind !== "ready" && kind !== "loading" && kind !== "auth_required" && kind !== "email_mismatch" ? (
          <NextActions kind={kind} orgId={preview?.orgId} token={token} />
        ) : null}
      </section>
    </main>
  );
}
