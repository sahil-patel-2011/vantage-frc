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
  inviteProfileHref,
  inviteProfileRedirect,
  inviteSignInHref,
  inviteTeamName,
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
  onboardingComplete?: boolean;
  signedIn?: boolean;
  emailMismatch?: boolean;
  sessionEmail?: string | null;
  /** The token was replaced by a newer invite to the same address (0721). */
  replaced?: { team: string | null } | null;
  error?: string;
};

function badgeClass(kind: InviteFlowKind): string {
  if (kind === "expired" || kind === "revoked" || kind === "replaced" || kind === "email_mismatch") return "warn";
  if (kind === "invalid" || kind === "error") return "danger";
  return "";
}

function NextActions({
  kind,
  orgId,
  token,
  signedIn,
  isInvitee,
}: {
  kind: InviteFlowKind;
  orgId?: string | null;
  token: string;
  signedIn: boolean;
  isInvitee: boolean;
}) {
  const actions = inviteNextActions({ kind, orgId, token, signedIn, isInvitee });
  if (actions.length === 0) return null;
  return (
    <section className="invite-next-actions" aria-label="Next steps">
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              {/* The action's own name is the link; a row of "Open" links said nothing. The main
                  step is a button ("Open Home" was a small text link). */}
              <a className={action.primary ? "signin-submit" : "invite-next-link"} href={action.href}>
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
          {/* The access they get, in the role words every screen uses. */}
          <span>ACCESS</span>
          <strong>{formatInviteRole(preview.role) ?? "Member"}</strong>
        </div>
        <div>
          <span>SENT TO</span>
          <strong>{preview.email}</strong>
        </div>
        <div>
          <span>EXPIRES</span>
          <strong><time dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time></strong>
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
  const acceptingRef = useRef(false);
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [legalRequired, setLegalRequired] = useState(true);
  const [profileRequired, setProfileRequired] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [replacedTeam, setReplacedTeam] = useState<{ team: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);

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
    const controller = new AbortController();
    setPreview(undefined);
    setLoadError(null);
    setAuthRequired(false);
    setEmailMismatch(false);
    setSessionEmail(null);
    setReplacedTeam(null);
    void fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        const data = (await response.json()) as PreviewResponse;
        if (!active) return;
        setSessionEmail(data.sessionEmail ?? null);
        setSignedIn(data.signedIn === true);
        setReplacedTeam(data.replaced ?? null);
        setLegalRequired(data.legalRequired !== false);
        setProfileRequired(data.profileRequired === true);
        setOnboardingComplete(typeof data.onboardingComplete === "boolean" ? data.onboardingComplete : null);
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
          setPreview(null);
          setLoadError("Could not load invitation details.");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, recovering, previewAttempt]);

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
    replaced: Boolean(replacedTeam),
  });
  // Dead links name the team (the preview has it, or the replaced token's team); a used link
  // tells only the signed-in person it was for that they joined (QA A3-09, A3-10).
  const isInvitee = signedIn && !emailMismatch && Boolean(preview);
  const empty = inviteEmptyCopy(kind, kind === "replaced" ? null : loadError, {
    team: replacedTeam?.team ?? inviteTeamName(preview ?? null),
    signedIn,
    isInvitee,
  });
  const canAccept = !profileRequired && inviteCanAccept({
    termsAccepted,
    privacyAccepted,
    legalRequired,
    status: preview?.status,
  });
  // A profile that was never finished goes to onboarding, which asks for it and the agreements
  // once and joins this team when done. Not a page of disabled buttons and a small link.
  const profileRedirect = inviteProfileRedirect({ kind, token, profileRequired, onboardingComplete });
  useEffect(() => {
    if (profileRedirect) window.location.replace(profileRedirect);
  }, [profileRedirect]);
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
    if (acceptingRef.current || kind !== "ready" || !canAccept) return;
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
    acceptingRef.current = true;
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
      if (!response.ok) {
        const failure = inviteAcceptanceFailure(response.status, data);
        if (failure.kind === "auth_required") setAuthRequired(true);
        if (failure.kind === "email_mismatch") setEmailMismatch(true);
        if (failure.kind === "profile_required") setProfileRequired(true);
        if (failure.kind === "error" && response.status === 400) setPreviewAttempt(current => current + 1);
        setMessageTone("error");
        setMessage(failure.message);
        return;
      }
      if (typeof data.orgId !== "string" || !data.orgId) throw new Error("Team membership could not be confirmed.");
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
      setMessageTone("error");
      setMessage("Could not confirm that you joined. Check your teams or retry this invitation when connected.");
    } finally {
      acceptingRef.current = false;
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

        {profileRequired && !profileRedirect && kind === "ready" ? (
          <p className="invite-message" role="status">
            Your profile does not confirm age eligibility yet. Your invitation stays available.
          </p>
        ) : null}

        {identityPreview ? <InviteIdentity preview={identityPreview} /> : null}
        {!token ? <p><a className="invite-next-link" href="/join-team">Join with a team code</a></p> : null}

        {showReady && profileRedirect ? (
          <p className="onboarding-sub" role="status">Opening your profile. Finishing it joins the team…</p>
        ) : showReady && profileRequired ? (
          <div className="invite-actions" id="invite-accept">
            <a className="signin-submit" href={inviteProfileHref(token)}>Review your profile</a>
          </div>
        ) : showReady ? (
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
                {/* The heading already says "different email"; this line says which two. */}
                <p className="onboarding-sub">
                  You are signed in as {sessionEmail || "a different email"}. This invite is for{" "}
                  {preview?.email || "another address"}.
                </p>
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
          <NextActions kind={kind} orgId={preview?.orgId} token={token} signedIn={signedIn} isInvitee={isInvitee} />
        ) : null}
      </section>
    </main>
  );
}
