"use client";

import { useWaitlistHref } from "../../lib/products/use-waitlist-href";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_CODE_TTL_SECONDS,
  SIGN_IN_FAILED_MESSAGE,
  WAITLIST_ONLY_MESSAGE,
  canResendCode,
  canSubmitCode,
  canRetrySubmittedCode,
  classifyOtpFailure,
  clearPendingCode,
  clearRememberedAccount,
  codeSecondsRemaining,
  emailOtpSetupRequired,
  shouldStartOnPassword,
  googleReady as isGoogleReady,
  initialSignInState,
  inviteTokenFromNext,
  isCodeComplete,
  isCodeExpired,
  isLikelyEmail,
  normalizeSignInEmail,
  oauthErrorMessage,
  parseRetryAfterSeconds,
  postAuthDestination,
  preferredSignInMethod,
  publicEmailUnavailableCopy,
  publicPasswordUnavailableCopy,
  readPendingCode,
  readRememberedAccount,
  resendSecondsRemaining,
  restoreInviteNextPath,
  sanitizeCodeInput,
  showCodeHelp,
  signInFlowReducer,
  signInStepCopy,
  signInUnavailableCopy,
  browserStorage,
  tabStorage,
  writePendingCode,
  writeRememberedAccount,
  type RememberedAccount,
  type SignInAuthStatus,
} from "../../lib/sign-in";
import { inviteJoiningHeadline, type InvitePreview } from "../../lib/invite";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { signOutAndRedirect } from "../../lib/sign-out";
import { requestPasswordResetCode } from "../../lib/sign-in/password-reset";
import {
  AccessFooter,
  InviteBanner,
  SetupShell,
  SignInCard,
  SignInStatusBlock,
} from "./sign-in-chrome";
import { SignInCodeStep, SignInNotInvited } from "./sign-in-code-step";
import { SignInIdentityStep, SignInPasswordFooter } from "./sign-in-identity";
import {
  readOnboardingGate,
  sessionProbeFromPayload,
  showCodeClock,
  showCodeResend,
  storedInviteTokenFrom,
  type PasswordPanel,
  type SessionProbe,
  type SignInBusy,
} from "./sign-in-model";
import { SignInRecovery } from "./sign-in-recovery";
import { SignInSessionView } from "./sign-in-session";
import "../product-styles";
import "./sign-in-flow.css";
import "../vantage-scan-auth.css";

type AuthStatus = SignInAuthStatus;

export default function SignInClient({
  googleEnabled,
  nextPath = "/dashboard",
  initialStatus,
  scouting = false,
}: {
  googleEnabled: boolean;
  nextPath?: string;
  initialStatus: AuthStatus;
  /** Signing in on the Scouting host. */
  scouting?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [flow, dispatch] = useReducer(signInFlowReducer, undefined, () => initialSignInState());
  const [busy, setBusy] = useState<SignInBusy>("idle");
  const [oauthMessage, setOauthMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [probe, setProbe] = useState<SessionProbe>({ state: "checking" });
  const [remembered, setRemembered] = useState<RememberedAccount>({ email: null, method: null });
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  /** The invite preview answered (or gave up), so the card can stop showing its placeholder. */
  const [invitePreviewSettled, setInvitePreviewSettled] = useState(false);
  /** Asked for a new code at least once on this step: the "no code yet?" help may show. */
  const [resentOnce, setResentOnce] = useState(false);
  const invitedPrefilled = useRef(false);
  const [resolvedNext, setResolvedNext] = useState(() => safeAppPath(nextPath, "/dashboard"));
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [passwordPanel, setPasswordPanel] = useState<PasswordPanel>(() =>
    shouldStartOnPassword(initialStatus) ? "password" : "closed",
  );
  const [password, setPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const authRequestRef = useRef(false);
  const leavingRef = useRef(false);

  const codeRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const lastSubmittedCode = useRef<string>("");
  // The code already sent for checking. Pressing Verify again for the same six digits only
  // spent a sign-in attempt and tripped the rate limit.
  const [triedCode, setTriedCode] = useState("");
  const requestedInitialCode = useRef(false);
  const prefilled = useRef(false);

  const googleAvailable = isGoogleReady(status, googleEnabled);
  const emailAvailable = !emailOtpSetupRequired(status);
  const unavailable = signInUnavailableCopy({ google: googleAvailable, email: emailAvailable });
  const inviteHeadline = inviteToken ? inviteJoiningHeadline(invitePreview) : null;
  const stepCopy = signInStepCopy(flow, inviteHeadline, status.publicSignup);

  useEffect(() => {
    if (flow.step !== "code") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [flow.step]);

  // The code step on this tab survives a reload (and the trip to the mail app, which often
  // reloads a phone's tab) while its code is good. Read once, before the write below runs.
  const restoredPending = useRef(false);
  useEffect(() => {
    if (restoredPending.current) return;
    restoredPending.current = true;
    const pending = readPendingCode(tabStorage(), Date.now());
    if (!pending) return;
    setClock(Date.now());
    dispatch({ type: "code_restored", ...pending });
  }, []);
  useEffect(() => {
    const live =
      flow.step === "code" &&
      flow.channel === "email-otp" &&
      flow.codeExpiresAt != null &&
      flow.codeExpiresAt > Date.now() &&
      !flow.failure?.needsNewCode;
    if (live && flow.codeExpiresAt != null) {
      writePendingCode(tabStorage(), { email: flow.email, codeExpiresAt: flow.codeExpiresAt, resendAvailableAt: flow.resendAvailableAt });
    } else {
      // The email step, the second factor, or a code that can no longer work.
      clearPendingCode(tabStorage());
    }
  }, [flow.step, flow.channel, flow.email, flow.codeExpiresAt, flow.resendAvailableAt, flow.failure]);

  // Back on the code step returns to the email step instead of leaving sign-in.
  useEffect(() => {
    if (flow.step !== "code" || flow.channel !== "email-otp") return;
    const current = (window.history.state ?? {}) as Record<string, unknown>;
    if (current.vantageSignin !== "code") window.history.pushState({ ...current, vantageSignin: "code" }, "");
    const onPop = () => {
      const state = (window.history.state ?? {}) as Record<string, unknown>;
      if (state.vantageSignin !== "code") dispatch({ type: "edit_email" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [flow.step, flow.channel]);

  /** "Edit" on the code step: step back through history when the code step added an entry. */
  function editEmail() {
    const current = (window.history.state ?? {}) as Record<string, unknown>;
    if (current.vantageSignin === "code") window.history.back();
    else dispatch({ type: "edit_email" });
  }

  const codeSeconds = codeSecondsRemaining(flow, clock);
  const resendSeconds = resendSecondsRemaining(flow, clock);
  const expired = isCodeExpired(flow, clock);
  const resendReady = canResendCode(flow, clock);
  const submitReady = canSubmitCode(flow, clock);

  const sendFirstFactorCode = useCallback(
    async (email: string, options?: { resent?: boolean }) => {
      if (authRequestRef.current) return false;
      authRequestRef.current = true;
      setBusy(options?.resent ? "resending" : "sending");
      try {
        const response = await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        if (!response.ok) {
          dispatch({
            type: "send_failed",
            now: Date.now(),
            failure: classifyOtpFailure({
              channel: "email-otp",
              status: response.status,
              code: payload.code,
              message: payload.message ?? status.emailOtpReason,
              retryAfterSeconds: parseRetryAfterSeconds(response.headers),
            }),
          });
          return false;
        }
        // The address is remembered once a sign-in works (verifyCode), not when a code is asked
        // for: a mistyped address, or one typed on a shared laptop and never used, stayed behind.
        lastSubmittedCode.current = "";
        setTriedCode("");
        if (options?.resent) setResentOnce(true);
        const sentAt = Date.now();
        // The countdown's clock only ticks on the code step; without this its first frame
        // counted from when the page opened ("Expires in 5:15").
        setClock(sentAt);
        dispatch({
          type: "code_sent",
          now: sentAt,
          email,
          expiresInSeconds: DEFAULT_CODE_TTL_SECONDS,
          resent: options?.resent,
        });
        return true;
      } catch {
        dispatch({
          type: "send_failed",
          now: Date.now(),
          failure: classifyOtpFailure({ channel: "email-otp", networkError: true }),
        });
        return false;
      } finally {
        authRequestRef.current = false;
        setBusy("idle");
      }
    },
    [status.emailOtpReason],
  );

  const sendSecondFactorCode = useCallback(
    async (options?: { resent?: boolean; emailHint?: string | null }) => {
      if (authRequestRef.current) return false;
      authRequestRef.current = true;
      setBusy(options?.resent ? "resending" : "sending");
      try {
        const response = await fetch("/api/auth/email-2fa", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "request" }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          expiresInSeconds?: number;
        };
        if (!response.ok) {
          dispatch({
            type: "send_failed",
            now: Date.now(),
            failure: classifyOtpFailure({
              channel: "email-2fa",
              status: response.status,
              message: payload.error ?? status.emailOtpReason,
              retryAfterSeconds: parseRetryAfterSeconds(response.headers),
            }),
          });
          return false;
        }
        lastSubmittedCode.current = "";
        setTriedCode("");
        const sentAt = Date.now();
        setClock(sentAt);
        dispatch({
          type: "code_sent",
          now: sentAt,
          emailHint: options?.emailHint ?? undefined,
          expiresInSeconds: Number(payload.expiresInSeconds ?? DEFAULT_CODE_TTL_SECONDS),
          resent: options?.resent,
        });
        return true;
      } catch {
        dispatch({
          type: "send_failed",
          now: Date.now(),
          failure: classifyOtpFailure({ channel: "email-2fa", networkError: true }),
        });
        return false;
      } finally {
        authRequestRef.current = false;
        setBusy("idle");
      }
    },
    [status.emailOtpReason],
  );

  const leave = useCallback(
    async (fallback?: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      setBusy("leaving");
      const gate = await readOnboardingGate();
      const destination = postAuthDestination({
        nextPath: fallback ?? resolvedNext,
        gate,
        inviteToken,
      });
      dispatch({ type: "verified", destination });
      window.location.assign(safeAppPath(destination, "/dashboard"));
    },
    [inviteToken, resolvedNext],
  );

  useEffect(() => {
    setRemembered(readRememberedAccount(browserStorage()));

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setOauthMessage(oauthErrorMessage(error));

    const rawNext = params.get("next") ?? nextPath;
    let stashed: string | null;
    try {
      stashed = storedInviteTokenFrom(sessionStorage);
    } catch {
      stashed = null;
    }
    const restored = restoreInviteNextPath(safeAppPath(rawNext, "/dashboard"), stashed);
    setResolvedNext(restored);
    const token = inviteTokenFromNext(restored) ?? stashed;
    setInviteToken(token);
  }, [nextPath]);

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => (response.ok ? ((await response.json()) as AuthStatus) : null))
      .then((value) => {
        if (value) setStatus(value);
      })
      .catch(() => undefined);
  }, []);

  /** Read-only session probe. Nothing here mutates a session. */
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/email-2fa", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => {
        if (!active) return;
        const data = response.ok
          ? ((await response.json()) as {
              authenticated?: boolean;
              requiresVerification?: boolean;
              emailHint?: string;
            })
          : null;
        if (!active) return;
        setProbe(sessionProbeFromPayload(response, data));
      })
      .catch(() => {
        if (active) setProbe({ state: "none" });
      });
    return () => {
      active = false;
    };
  }, []);

  /** A session that still owes a second factor goes straight to the code step. */
  useEffect(() => {
    if (probe.state !== "needs_verification") return;
    // A first-factor code step kept from before a reload (pending-code.ts) does not stand in the
    // way: a session that owes its second factor goes there.
    if (busy !== "idle" || flow.channel === "email-2fa" || authRequestRef.current || leavingRef.current) return;
    if (requestedInitialCode.current) return;
    requestedInitialCode.current = true;
    dispatch({ type: "second_factor_required", emailHint: probe.emailHint || null });
    void sendSecondFactorCode({ emailHint: probe.emailHint });
  }, [probe, busy, flow.step, sendSecondFactorCode]);

  /** Invite context, kept visible for the whole flow. */
  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    void fetch(`/api/invites/preview?token=${encodeURIComponent(inviteToken)}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { preview?: InvitePreview | null };
        if (active && data.preview) setInvitePreview(data.preview);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setInvitePreviewSettled(true);
      });
    return () => {
      active = false;
    };
  }, [inviteToken]);

  /**
   * Prefill the remembered address exactly once. Without the latch, clearing the
   * field to type a different address would immediately refill it.
   */
  useEffect(() => {
    // An invite names the one address that can accept it. On a shared shop
    // laptop the remembered address is someone else's — prefilling it sent
    // the new member's code to a teammate's inbox. The invite wins.
    if (inviteToken) return;
    if (prefilled.current || !remembered.email) return;
    prefilled.current = true;
    if (flow.email) return;
    dispatch({ type: "email_changed", email: remembered.email });
  }, [flow.email, remembered.email, inviteToken]);

  useEffect(() => {
    const invited = invitePreview?.email?.trim();
    if (!invited || invitedPrefilled.current) return;
    invitedPrefilled.current = true;
    // Leave an address the person typed themselves alone.
    if (flow.email && flow.email !== remembered.email) return;
    dispatch({ type: "email_changed", email: invited });
  }, [invitePreview, flow.email, remembered.email]);

  useEffect(() => {
    if (flow.step === "code" || (passwordPanel === "reset" && resetSent)) codeRef.current?.focus();
  }, [flow.step, passwordPanel, resetSent]);

  const verifyCode = useCallback(async () => {
    const code = sanitizeCodeInput(flow.code);
    if (!canSubmitCode(flow, Date.now()) || authRequestRef.current || leavingRef.current) return;
    authRequestRef.current = true;
    lastSubmittedCode.current = code;
    setTriedCode(code);
    setBusy("verifying");
    try {
      const isSecondFactor = flow.channel === "email-2fa";
      const response = await fetch(
        isSecondFactor ? "/api/auth/email-2fa" : "/api/auth/sign-in/email-otp",
        {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isSecondFactor ? { action: "verify", code } : { email: flow.email, otp: code },
          ),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        dispatch({
          type: "code_failed",
          now: Date.now(),
          failure: classifyOtpFailure({
            channel: flow.channel,
            status: response.status,
            code: payload.code,
            message: payload.error ?? payload.message ?? SIGN_IN_FAILED_MESSAGE,
            retryAfterSeconds: parseRetryAfterSeconds(response.headers, 0) || undefined,
          }),
        });
        return;
      }
      if (isSecondFactor) {
        await leave();
        return;
      }
      // Remembered only now that the address has signed in (cleared again at sign-out).
      writeRememberedAccount(browserStorage(), { email: flow.email, method: "email" });
      clearPendingCode(tabStorage());
      // A first-factor email code already proves mailbox control, so Better Auth
      // marks the session 2FA-satisfied — no second prompt.
      await leave();
    } catch {
      dispatch({
        type: "code_failed",
        now: Date.now(),
        failure: classifyOtpFailure({ channel: flow.channel, networkError: true }),
      });
    } finally {
      authRequestRef.current = false;
      if (!leavingRef.current) setBusy("idle");
    }
  }, [flow, leave]);

  /** Auto-submit the moment the sixth digit lands — never twice for one code. */
  useEffect(() => {
    if (busy !== "idle") return;
    if (!canSubmitCode(flow, Date.now())) return;
    if (flow.failure?.kind === "rate_limited") return;
    if (flow.code === lastSubmittedCode.current) return;
    void verifyCode();
  }, [busy, flow, verifyCode]);

  async function submitIdentity(event: FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    if (!isLikelyEmail(email) || !emailAvailable || busy !== "idle" || (flow.failure?.kind === "rate_limited" && resendSeconds > 0)) return;
    await sendFirstFactorCode(email);
  }

  async function resend() {
    if (!resendReady || busy !== "idle") return;
    if (flow.channel === "email-2fa") {
      await sendSecondFactorCode({ resent: true });
      return;
    }
    await sendFirstFactorCode(normalizeSignInEmail(flow.email), { resent: true });
  }

  async function google() {
    if (!googleAvailable || busy !== "idle" || authRequestRef.current || leavingRef.current) return;
    authRequestRef.current = true;
    setBusy("google");
    setOauthMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: resolvedNext,
          errorCallbackURL: `/signin?next=${encodeURIComponent(resolvedNext)}`,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
        error?: string;
      };
      if (response.ok && data.url) {
        writeRememberedAccount(browserStorage(), { method: "google" });
        window.location.assign(data.url);
        return;
      }
      setOauthMessage(
        oauthErrorMessage(data.error ?? data.message ?? "signup_disabled") || WAITLIST_ONLY_MESSAGE,
      );
    } catch {
      setOauthMessage("Couldn’t reach Google sign-in. Check your connection and try again.");
    } finally {
      authRequestRef.current = false;
      setBusy("idle");
    }
  }

  async function passwordSignIn(event: FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    if (authRequestRef.current || leavingRef.current || busy !== "idle" || !isLikelyEmail(email) || !password || !status.passwordSignInAvailable) return;
    authRequestRef.current = true;
    setBusy("verifying");
    setPasswordMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        writeRememberedAccount(browserStorage(), { email, method: "email" });
        // Password alone never satisfies email 2FA, so ask the probe again.
        const elevation = await fetch("/api/auth/email-2fa", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(8_000) });
        if (!elevation.ok) throw new Error("Verification could not be checked");
        const data = elevation.ok
          ? ((await elevation.json()) as { authenticated?: boolean; requiresVerification?: boolean; emailHint?: string })
          : null;
        if (data?.authenticated !== true || typeof data.requiresVerification !== "boolean") throw new Error("Verification could not be confirmed");
        if (data?.requiresVerification) {
          setPasswordPanel("closed");
          setPassword("");
          requestedInitialCode.current = true;
          dispatch({ type: "second_factor_required", emailHint: data.emailHint ?? null });
          authRequestRef.current = false;
          await sendSecondFactorCode({ emailHint: data.emailHint ?? null });
          return;
        }
        await leave();
        return;
      }
      setPasswordMessage(
        response.status === 429 ? "Too many sign-in attempts. Wait a few minutes before trying again."
          : response.status >= 500 ? "Sign-in is temporarily unavailable. Your details are still here. Try again shortly."
          : status.passwordSignInAvailable
          ? // "Check your email" read as "look in your inbox"; say which thing did not match.
            "That email and password don’t match. Try again, or use an email code instead."
          : publicPasswordUnavailableCopy(status.passwordReason),
      );
    } catch {
      setPasswordMessage("Couldn’t reach Vantage. Check your connection and try again.");
    } finally {
      authRequestRef.current = false;
      if (!leavingRef.current) setBusy("idle");
    }
  }

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    if (authRequestRef.current || leavingRef.current || busy !== "idle" || !isLikelyEmail(email)) return;
    if (!emailAvailable) {
      setPasswordMessage(publicEmailUnavailableCopy(status.emailOtpReason));
      return;
    }
    if (resetSent && (!isCodeComplete(sanitizeCodeInput(flow.code)) || password.length < 12)) return;
    authRequestRef.current = true;
    setBusy("sending");
    setPasswordMessage("");
    try {
      if (!resetSent) {
        await requestPasswordResetCode(email);
        setResetSent(true);
        setPassword("");
        setPasswordMessage(
          "If that address has a Vantage account, a short-lived reset code is on the way.",
        );
        return;
      }
      const response = await fetch("/api/auth/email-otp/reset-password", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp: sanitizeCodeInput(flow.code), password }),
      });
      if (response.ok) {
        setPasswordPanel("password");
        setResetSent(false);
        setPassword("");
        dispatch({ type: "code_changed", code: "" });
        setPasswordMessage("Password updated. Existing sessions were revoked — sign in again.");
        return;
      }
      setPasswordMessage(response.status === 429 ? "Too many reset attempts. Wait a few minutes before trying again."
        : response.status >= 500 ? "Password reset is temporarily unavailable. Your code is still here; try again shortly."
        : "That reset code is invalid, expired, or out of attempts.");
    } catch (error) {
      setPasswordMessage(error instanceof Error && error.name === "Error" ? error.message : "Couldn’t confirm the reset request. Check your connection and try again.");
    } finally {
      authRequestRef.current = false;
      setBusy("idle");
    }
  }

  function forgetAccount() {
    if (authRequestRef.current || leavingRef.current) return;
    clearRememberedAccount(browserStorage());
    setRemembered({ email: null, method: null });
    dispatch({ type: "email_changed", email: "" });
    emailRef.current?.focus();
  }

  function changeEmail(email: string) {
    if (authRequestRef.current || leavingRef.current) return;
    if (normalizeSignInEmail(email) !== normalizeSignInEmail(flow.email)) {
      setResetSent(false); setPassword(""); setPasswordMessage("");
      dispatch({ type: "code_changed", code: "" });
    }
    dispatch({ type: "email_changed", email });
  }

  const preferred = useMemo(
    () => preferredSignInMethod(remembered, { google: googleAvailable, email: emailAvailable }),
    [remembered, googleAvailable, emailAvailable],
  );

  const failureKind = flow.failure?.kind;
  useEffect(() => {
    if (failureKind === "wrong_code") codeRef.current?.focus();
  }, [failureKind, flow.failedAttempts]);

  useEffect(() => {
    if (flow.step === "identity") setResentOnce(false);
  }, [flow.step]);

  const working = busy !== "idle";
  const notInvited = flow.step !== "identity" && flow.failure?.kind === "not_authorized";
  const waitlistHref = useWaitlistHref();
  // Someone holding an invitation needs the code form and the team's name, nothing else: the
  // password, recovery and waitlist options asked a first-time student to leave the invite.
  const invited = Boolean(inviteToken);
  // Until the invitation is read, a placeholder, so the heading does not change from "a team"
  // to the team's name under the person's eyes.
  const inviteLoading = invited && !invitePreviewSettled && flow.step === "identity";

  if (probe.state === "active") {
    return (
      <SignInSessionView
        inviteHeadline={inviteHeadline}
        inviteToken={inviteToken}
        invitePreview={invitePreview}
        emailHint={probe.emailHint}
        working={working}
        resolvedNext={resolvedNext}
        onContinue={() => void leave()}
        onSwitchAccount={(href) => void signOutAndRedirect(href)}
        scouting={scouting}
      />
    );
  }

  return (
    <SignInCard
      scouting={scouting}
      titleId="signin-title"
      title={inviteLoading ? "Opening your invitation…" : notInvited ? "You’re not on a team yet" : stepCopy.title}
      subtitle={
        recoveryOpen || inviteLoading
          ? undefined
          : passwordPanel === "password"
          ? "Use the email and password for your team account."
          : passwordPanel === "reset"
            ? "Request an email code, then choose a new password."
            : notInvited
              ? undefined
              : flow.channel === "email-2fa" && !flow.codeExpiresAt
                ? "Request an email code to finish signing in with this account."
              : stepCopy.sub
      }
    >
      {inviteLoading ? null : <InviteBanner token={inviteToken} preview={invitePreview} />}
      {status.localAcceptanceSignup ? (
        <p role="status">Local acceptance test: accounts use an isolated test database. Production signup remains closed.</p>
      ) : null}
      {unavailable ? <SetupShell copy={unavailable} /> : null}

      {recoveryOpen ? null : (
      <>
      <div className="signin-step">
        {inviteLoading ? (
          <div className="signin-invite-loading" aria-busy="true" aria-label="Opening your invitation">
            <span />
            <span />
          </div>
        ) : flow.step === "identity" ? (
          <SignInIdentityStep
            googleAvailable={googleAvailable}
            emailAvailable={emailAvailable}
            preferred={preferred}
            rememberedEmail={remembered.email}
            email={flow.email}
            emailRef={emailRef}
            busy={busy}
            working={working}
            passwordPanel={passwordPanel}
            emailCooldown={flow.failure?.kind === "rate_limited" ? resendSeconds : 0}
            resetSent={resetSent}
            password={password}
            passwordMessage={passwordMessage}
            code={flow.code}
            codeRef={codeRef}
            onGoogle={() => void google()}
            onSubmitIdentity={(event) => void submitIdentity(event)}
            onEmailChange={changeEmail}
            onEmailBlur={(email) =>
              dispatch({ type: "email_changed", email: normalizeSignInEmail(email) })
            }
            onForgetAccount={forgetAccount}
            onPasswordSubmit={(event) =>
              void (passwordPanel === "reset" ? requestPasswordReset(event) : passwordSignIn(event))
            }
            onPasswordChange={setPassword}
            onCodeChange={(code) => dispatch({ type: "code_changed", code })}
            invited={invited}
          />
        ) : notInvited ? (
          <SignInNotInvited
            email={normalizeSignInEmail(flow.email)}
            waitlistHref={waitlistHref}
            onUseAnotherEmail={() => dispatch({ type: "edit_email" })}
          />
        ) : (
          <SignInCodeStep
            channel={flow.channel}
            email={flow.email}
            emailHint={flow.emailHint}
            code={flow.code}
            codeRef={codeRef}
            emailAvailable={emailAvailable}
            // A rate limit is not a wrong code: the boxes stay neutral, not red.
            invalid={Boolean(flow.failure) && flow.failure?.kind !== "rate_limited"}
            failureMessage={flow.failure?.message ?? null}
            failureKind={flow.failure?.kind ?? null}
            retryAfterSeconds={flow.failure?.kind === "rate_limited" ? Math.max(0, Math.ceil(((flow.verifyAvailableAt ?? flow.resendAvailableAt ?? clock) - clock) / 1000)) : null}
            expired={expired}
            showClock={showCodeClock(flow.failure?.kind)}
            showResend={showCodeResend(flow.failure?.kind)}
            codeSeconds={codeSeconds}
            resendReady={resendReady}
            resendSeconds={resendSeconds}
            submitReady={submitReady && (flow.code !== triedCode || canRetrySubmittedCode(flow, clock))}
            busy={busy}
            working={working}
            resolvedNext={resolvedNext}
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
            onCodeChange={(code) => dispatch({ type: "code_changed", code })}
            onEditEmail={editEmail}
            onResend={() => void resend()}
            onSwitchAccount={(href) => void signOutAndRedirect(href)}
            inviteHelp={
              !inviteToken && !status.publicSignup && showCodeHelp(flow, clock, { resentOnce }) ? { waitlistHref } : null
            }
          />
        )}
      </div>

      <SignInStatusBlock
        // On the code step the reason sits under the boxes instead (SignInCodeStep).
        failure={notInvited || flow.step === "code" ? null : (flow.failure?.message ?? null)}
        notice={flow.notice}
        oauthMessage={oauthMessage}
      />
      </>
      )}

      <div className="signin-footer">
        {/* Kept for an invitation only when email codes are off, so there is still a way in. */}
        {recoveryOpen || (invited && emailAvailable) ? null : (
        <SignInPasswordFooter
          working={working}
          passwordSignInAvailable={status.passwordSignInAvailable}
          emailAvailable={emailAvailable}
          identityStep={flow.step === "identity"}
          passwordPanel={passwordPanel}
          onUsePassword={() => {
            setPasswordMessage("");
            setResetSent(false); dispatch({ type: "code_changed", code: "" });
            setPasswordPanel("password");
          }}
          onBackToCodes={() => {
            setPasswordPanel("closed");
            setResetSent(false);
            setPassword("");
            setPasswordMessage("");
            dispatch({ type: "code_changed", code: "" });
          }}
          onForgotPassword={() => {
            setPasswordMessage("");
            setResetSent(false);
            setPassword(""); dispatch({ type: "code_changed", code: "" });
            setPasswordPanel("reset");
          }}
        />
        )}
        {emailAvailable && flow.step === "identity" && passwordPanel === "closed" && !invited ? (
          <SignInRecovery nextPath={resolvedNext} open={recoveryOpen} onOpenChange={setRecoveryOpen} />
        ) : null}
        {/* The not-on-a-team step leads with Join the waitlist, and the code step has its own
            "No code?" help with the same link; a second one under it was noise. Someone with an
            invitation is not sent toward the waitlist at all. */}
        {notInvited || flow.step === "code" || invited ? null : <AccessFooter publicSignup={status.publicSignup} />}
      </div>
    </SignInCard>
  );
}
