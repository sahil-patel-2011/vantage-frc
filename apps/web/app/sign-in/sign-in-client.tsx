"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { VantageLogo } from "../../components/brand";
import {
  DEFAULT_CODE_TTL_SECONDS,
  OTP_LENGTH,
  SIGN_IN_FAILED_MESSAGE,
  WAITLIST_ONLY_MESSAGE,
  activeDigitIndex,
  canResendCode,
  canSubmitCode,
  classifyOtpFailure,
  clearRememberedAccount,
  codeDigits,
  codeFromPastedText,
  codeSecondsRemaining,
  emailOtpSetupRequired,
  formatCooldown,
  formatCountdown,
  googleReady as isGoogleReady,
  initialSignInState,
  inviteTokenFromNext,
  invitedOnlyHint,
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
  readRememberedAccount,
  resendSecondsRemaining,
  restoreInviteNextPath,
  sanitizeCodeInput,
  signInFlowReducer,
  signInStepCopy,
  signInUnavailableCopy,
  browserStorage,
  writeRememberedAccount,
  type RememberedAccount,
  type SignInAuthStatus,
  type SignInSetupCopy,
} from "../../lib/sign-in";
import {
  PENDING_INVITE_STORAGE_KEY,
  inviteJoiningHeadline,
  type InvitePreview,
} from "../../lib/invite";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { signOutAndRedirect } from "../../lib/sign-out";
import "./sign-in-flow.css";

type AuthStatus = SignInAuthStatus;

type Busy = "idle" | "sending" | "verifying" | "resending" | "google" | "leaving";

/** What the read-only session probe (`GET /api/auth/email-2fa`) told us. */
type SessionProbe =
  | { state: "checking" }
  | { state: "none" }
  | { state: "needs_verification"; emailHint: string }
  | { state: "active"; emailHint: string };

/* --------------------------------- helpers --------------------------------- */

async function readOnboardingGate() {
  try {
    const response = await fetch("/api/onboarding", { credentials: "include" });
    if (!response.ok) return null;
    return (await response.json()) as { complete?: boolean; accessStatus?: string };
  } catch {
    return null;
  }
}

function storedInviteToken(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/* -------------------------------- components -------------------------------- */

function SetupShell({ copy }: { copy: SignInSetupCopy }) {
  return (
    <div className="signin-setup-shell" role="status">
      <span>{copy.badge}</span>
      <strong>{copy.title}</strong>
      <p>{copy.description}</p>
    </div>
  );
}

function AccessFooter() {
  return (
    <p className="signin-waitlist">
      Need access? <a href="/#waitlist">Join the waitlist</a>
      <span aria-hidden="true"> · </span>
      <a href="/pricing">Pricing</a>
    </p>
  );
}

/**
 * Six boxes the eye can count, one real input underneath.
 *
 * The single input is what carries `autocomplete="one-time-code"`, so iOS and
 * Android offer the code from the mail/SMS notification, and a full-code paste
 * lands in one place instead of scattering across six separate fields.
 */
function CodeInput({
  value,
  disabled,
  invalid,
  inputRef,
  onChange,
}: {
  value: string;
  disabled: boolean;
  invalid: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (next: string) => void;
}) {
  const digits = codeDigits(value);
  const active = activeDigitIndex(value);
  const [focused, setFocused] = useState(false);

  return (
    /* The input is absolutely positioned over the boxes, so a click anywhere in
       this block already lands on it — no extra click handler to keyboard-trap. */
    <div className={`signin-code${invalid ? " invalid" : ""}${disabled ? " disabled" : ""}`}>
      <input
        ref={inputRef}
        className="signin-code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={`${OTP_LENGTH}-digit sign-in code`}
        aria-invalid={invalid || undefined}
        maxLength={OTP_LENGTH}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(sanitizeCodeInput(event.target.value))}
        onPaste={(event) => {
          const pasted = codeFromPastedText(event.clipboardData.getData("text"));
          if (!pasted) return;
          event.preventDefault();
          onChange(pasted);
        }}
      />
      <div className="signin-code-boxes" aria-hidden="true">
        {digits.map((digit, index) => (
          <span
            key={index}
            className={
              focused && !disabled && index === active && digits[index] === ""
                ? "signin-code-box caret"
                : "signin-code-box"
            }
          >
            {digit}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- client ---------------------------------- */

export default function SignInClient({
  googleEnabled,
  nextPath = "/dashboard",
  initialStatus,
}: {
  googleEnabled: boolean;
  nextPath?: string;
  initialStatus: AuthStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [flow, dispatch] = useReducer(signInFlowReducer, undefined, () => initialSignInState());
  const [busy, setBusy] = useState<Busy>("idle");
  const [oauthMessage, setOauthMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [probe, setProbe] = useState<SessionProbe>({ state: "checking" });
  const [remembered, setRemembered] = useState<RememberedAccount>({ email: null, method: null });
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [resolvedNext, setResolvedNext] = useState(() => safeAppPath(nextPath, "/dashboard"));
  const [passwordPanel, setPasswordPanel] = useState<"closed" | "password" | "reset">("closed");
  const [password, setPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const codeRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const lastSubmittedCode = useRef<string>("");
  const requestedInitialCode = useRef(false);
  const prefilled = useRef(false);

  const googleAvailable = isGoogleReady(status, googleEnabled);
  const emailAvailable = !emailOtpSetupRequired(status);
  const unavailable = signInUnavailableCopy({ google: googleAvailable, email: emailAvailable });
  const inviteHeadline = inviteToken ? inviteJoiningHeadline(invitePreview) : null;
  const stepCopy = signInStepCopy(flow, inviteHeadline);

  /* -------------------------------- one clock -------------------------------- */

  useEffect(() => {
    if (flow.step !== "code") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [flow.step]);

  const codeSeconds = codeSecondsRemaining(flow, clock);
  const resendSeconds = resendSecondsRemaining(flow, clock);
  const expired = isCodeExpired(flow, clock);
  const resendReady = canResendCode(flow, clock);
  const submitReady = canSubmitCode(flow, clock);

  /* ------------------------------ request a code ----------------------------- */

  const sendFirstFactorCode = useCallback(
    async (email: string, options?: { resent?: boolean }) => {
      setBusy(options?.resent ? "resending" : "sending");
      try {
        const response = await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
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
        writeRememberedAccount(browserStorage(), { email, method: "email" });
        setRemembered({ email, method: "email" });
        lastSubmittedCode.current = "";
        dispatch({
          type: "code_sent",
          now: Date.now(),
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
        setBusy("idle");
      }
    },
    [status.emailOtpReason],
  );

  const sendSecondFactorCode = useCallback(
    async (options?: { resent?: boolean; emailHint?: string | null }) => {
      setBusy(options?.resent ? "resending" : "sending");
      try {
        const response = await fetch("/api/auth/email-2fa", {
          method: "POST",
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
        dispatch({
          type: "code_sent",
          now: Date.now(),
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
        setBusy("idle");
      }
    },
    [status.emailOtpReason],
  );

  /* ------------------------------- where to land ------------------------------ */

  const leave = useCallback(
    async (fallback?: string) => {
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

  /* --------------------------------- bootstrap -------------------------------- */

  useEffect(() => {
    setRemembered(readRememberedAccount(browserStorage()));

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setOauthMessage(oauthErrorMessage(error));

    const rawNext = params.get("next") ?? nextPath;
    const stashed = storedInviteToken();
    const restored = restoreInviteNextPath(safeAppPath(rawNext, "/dashboard"), stashed);
    setResolvedNext(restored);
    const token = inviteTokenFromNext(restored) ?? stashed;
    setInviteToken(token);
  }, [nextPath]);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then(async (response) => (response.ok ? ((await response.json()) as AuthStatus) : null))
      .then((value) => {
        if (value) setStatus(value);
      })
      .catch(() => undefined);
  }, []);

  /** Read-only session probe. Nothing here mutates a session. */
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/email-2fa", { credentials: "include" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setProbe({ state: "none" });
          return;
        }
        if (!response.ok) {
          setProbe({ state: "none" });
          return;
        }
        const data = (await response.json()) as {
          authenticated?: boolean;
          requiresVerification?: boolean;
          emailHint?: string;
        };
        if (!active) return;
        if (!data.authenticated) {
          setProbe({ state: "none" });
          return;
        }
        setProbe(
          data.requiresVerification
            ? { state: "needs_verification", emailHint: data.emailHint ?? "" }
            : { state: "active", emailHint: data.emailHint ?? "" },
        );
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
    if (requestedInitialCode.current) return;
    requestedInitialCode.current = true;
    dispatch({ type: "second_factor_required", emailHint: probe.emailHint || null });
    void sendSecondFactorCode({ emailHint: probe.emailHint });
  }, [probe, sendSecondFactorCode]);

  /** Invite context, kept visible for the whole flow. */
  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    void fetch(`/api/invites/preview?token=${encodeURIComponent(inviteToken)}`)
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { preview?: InvitePreview | null };
        if (active && data.preview) setInvitePreview(data.preview);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [inviteToken]);

  /**
   * Prefill the remembered address exactly once. Without the latch, clearing the
   * field to type a different address would immediately refill it.
   */
  useEffect(() => {
    if (prefilled.current || !remembered.email) return;
    prefilled.current = true;
    if (flow.email) return;
    dispatch({ type: "email_changed", email: remembered.email });
  }, [flow.email, remembered.email]);

  useEffect(() => {
    if (flow.step === "code") codeRef.current?.focus();
  }, [flow.step]);

  /* ------------------------------- verify a code ------------------------------ */

  const verifyCode = useCallback(async () => {
    const code = sanitizeCodeInput(flow.code);
    if (!isCodeComplete(code)) return;
    lastSubmittedCode.current = code;
    setBusy("verifying");
    try {
      const isSecondFactor = flow.channel === "email-2fa";
      const response = await fetch(
        isSecondFactor ? "/api/auth/email-2fa" : "/api/auth/sign-in/email-otp",
        {
          method: "POST",
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
      setBusy("idle");
    }
  }, [flow.channel, flow.code, flow.email, leave]);

  /** Auto-submit the moment the sixth digit lands — never twice for one code. */
  useEffect(() => {
    if (flow.step !== "code") return;
    if (busy !== "idle") return;
    if (!isCodeComplete(flow.code)) return;
    if (flow.code === lastSubmittedCode.current) return;
    if (isCodeExpired(flow, Date.now())) return;
    void verifyCode();
  }, [busy, flow, verifyCode]);

  /* --------------------------------- actions --------------------------------- */

  async function submitIdentity(event: React.FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    if (!isLikelyEmail(email) || !emailAvailable || busy !== "idle") return;
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
    if (!googleAvailable || busy !== "idle") return;
    setBusy("google");
    setOauthMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
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
      if (data.url) {
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
      setBusy("idle");
    }
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    setBusy("verifying");
    setPasswordMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        writeRememberedAccount(browserStorage(), { email, method: "email" });
        // Password alone never satisfies email 2FA, so ask the probe again.
        const elevation = await fetch("/api/auth/email-2fa", { credentials: "include" });
        const data = elevation.ok
          ? ((await elevation.json()) as { requiresVerification?: boolean; emailHint?: string })
          : null;
        if (data?.requiresVerification) {
          setPasswordPanel("closed");
          setPassword("");
          requestedInitialCode.current = true;
          dispatch({ type: "second_factor_required", emailHint: data.emailHint ?? null });
          await sendSecondFactorCode({ emailHint: data.emailHint ?? null });
          return;
        }
        await leave();
        return;
      }
      setPasswordMessage(
        status.passwordSignInAvailable
          ? SIGN_IN_FAILED_MESSAGE
          : publicPasswordUnavailableCopy(status.passwordReason),
      );
    } catch {
      setPasswordMessage("Couldn’t reach Vantage. Check your connection and try again.");
    } finally {
      setBusy("idle");
    }
  }

  async function requestPasswordReset(event: React.FormEvent) {
    event.preventDefault();
    const email = normalizeSignInEmail(flow.email);
    if (!emailAvailable) {
      setPasswordMessage(publicEmailUnavailableCopy(status.emailOtpReason));
      return;
    }
    setBusy("sending");
    setPasswordMessage("");
    try {
      if (!resetSent) {
        await fetch("/api/auth/email-otp/request-password-reset", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setResetSent(true);
        setPassword("");
        setPasswordMessage(
          "If that address has a Vantage account, a short-lived reset code is on the way.",
        );
        return;
      }
      const response = await fetch("/api/auth/email-otp/reset-password", {
        method: "POST",
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
      setPasswordMessage("That reset code is invalid, expired, or out of attempts.");
    } catch {
      setPasswordMessage("Couldn’t reach Vantage. Check your connection and try again.");
    } finally {
      setBusy("idle");
    }
  }

  function forgetAccount() {
    clearRememberedAccount(browserStorage());
    setRemembered({ email: null, method: null });
    dispatch({ type: "email_changed", email: "" });
    emailRef.current?.focus();
  }

  /* ---------------------------------- render ---------------------------------- */

  const preferred = useMemo(
    () => preferredSignInMethod(remembered, { google: googleAvailable, email: emailAvailable }),
    [remembered, googleAvailable, emailAvailable],
  );

  const hint = invitedOnlyHint(flow);
  const working = busy !== "idle";

  const inviteBanner = inviteToken ? (
    <div className="signin-invite" role="note">
      <span>INVITATION</span>
      <strong>{inviteHeadline}</strong>
      <p>
        {invitePreview?.email
          ? `Sign in as ${invitePreview.email} — this invite only works for that address. You’ll land back on the acceptance screen.`
          : "Finish signing in and you’ll come straight back to the acceptance screen."}
      </p>
    </div>
  ) : null;

  // "Continue as" — a live session, so the form would only be noise.
  if (probe.state === "active") {
    return (
      <main className="signin-page">
        <section className="signin-card" aria-labelledby="signin-title">
          <div className="signin-brand">
            <VantageLogo />
          </div>
          <h1 id="signin-title">{inviteHeadline ?? "You’re already signed in"}</h1>
          <p className="signin-sub">Continue with the account already open in this browser.</p>
          {inviteBanner}
          <div className="signin-step">
            <button
              type="button"
              className="signin-submit"
              disabled={working}
              onClick={() => void leave()}
            >
              {working ? "Continuing…" : `Continue as ${probe.emailHint || "this account"}`}
            </button>
            <button
              type="button"
              className="signin-link signin-link-block"
              disabled={working}
              onClick={() => void signOutAndRedirect(`/signin?next=${encodeURIComponent(resolvedNext)}`)}
            >
              Use a different account
            </button>
          </div>
          <AccessFooter />
        </section>
      </main>
    );
  }

  return (
    <main className="signin-page">
      <section className="signin-card" aria-labelledby="signin-title">
        <div className="signin-brand">
          <VantageLogo />
        </div>
        <h1 id="signin-title">{stepCopy.title}</h1>
        <p className="signin-sub">{stepCopy.sub}</p>

        {inviteBanner}
        {unavailable ? <SetupShell copy={unavailable} /> : null}

        <div className="signin-step">
          {flow.step === "identity" ? (
            <>
              {googleAvailable ? (
                <>
                  <button
                    className="signin-google"
                    type="button"
                    onClick={() => void google()}
                    disabled={working}
                  >
                    <GoogleMark />
                    {busy === "google" ? "Opening Google…" : "Continue with Google"}
                    {preferred === "google" ? <em className="signin-last-used">Last used</em> : null}
                  </button>
                  <div className="signin-or" role="separator">
                    <span>or</span>
                  </div>
                </>
              ) : null}

              {passwordPanel === "closed" ? (
                <form className="signin-form" onSubmit={(event) => void submitIdentity(event)}>
                  <label>
                    Email
                    <span className="signin-field">
                      <MailIcon />
                      <input
                        ref={emailRef}
                        type="email"
                        required
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@example.com"
                        value={flow.email}
                        disabled={!emailAvailable || working}
                        autoFocus={preferred === "email" && !remembered.email}
                        onChange={(event) =>
                          dispatch({ type: "email_changed", email: event.target.value })
                        }
                        onBlur={(event) =>
                          dispatch({
                            type: "email_changed",
                            email: normalizeSignInEmail(event.target.value),
                          })
                        }
                      />
                    </span>
                    {remembered.email ? (
                      <small className="signin-remembered">
                        Remembered on this device.{" "}
                        <button type="button" className="signin-link" onClick={forgetAccount}>
                          Forget
                        </button>
                      </small>
                    ) : null}
                  </label>
                  <button
                    className="signin-submit"
                    disabled={!emailAvailable || working || !isLikelyEmail(flow.email)}
                  >
                    {busy === "sending" ? "Sending code…" : "Email me a sign-in code"}
                  </button>
                </form>
              ) : (
                <form
                  className="signin-form"
                  onSubmit={(event) =>
                    void (passwordPanel === "reset"
                      ? requestPasswordReset(event)
                      : passwordSignIn(event))
                  }
                >
                  <label>
                    Email
                    <span className="signin-field">
                      <MailIcon />
                      <input
                        type="email"
                        required
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={flow.email}
                        disabled={working}
                        onChange={(event) =>
                          dispatch({ type: "email_changed", email: event.target.value })
                        }
                      />
                    </span>
                  </label>
                  {passwordPanel === "reset" && resetSent ? (
                    <label>
                      Reset code
                      <CodeInput
                        value={flow.code}
                        disabled={working}
                        invalid={false}
                        inputRef={codeRef}
                        onChange={(next) => dispatch({ type: "code_changed", code: next })}
                      />
                    </label>
                  ) : null}
                  {passwordPanel === "password" || resetSent ? (
                    <label>
                      {passwordPanel === "reset" ? "New password" : "Password"}
                      <span className="signin-field">
                        <LockIcon />
                        <input
                          type="password"
                          required
                          minLength={passwordPanel === "reset" ? 12 : undefined}
                          autoComplete={
                            passwordPanel === "reset" ? "new-password" : "current-password"
                          }
                          value={password}
                          disabled={working}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </span>
                    </label>
                  ) : null}
                  <button className="signin-submit" disabled={working}>
                    {passwordPanel === "reset"
                      ? resetSent
                        ? "Set new password"
                        : "Send reset code"
                      : working
                        ? "Signing in…"
                        : "Sign in with password"}
                  </button>
                  {passwordMessage ? (
                    <p className="signin-status" role="status">
                      {passwordMessage}
                    </p>
                  ) : null}
                </form>
              )}
            </>
          ) : (
            <form
              className="signin-form"
              onSubmit={(event) => {
                event.preventDefault();
                void verifyCode();
              }}
            >
              <div className="signin-code-target">
                <strong>{flow.channel === "email-2fa" ? flow.emailHint : flow.email}</strong>
                {flow.channel === "email-otp" ? (
                  <button
                    type="button"
                    className="signin-link"
                    disabled={working}
                    onClick={() => dispatch({ type: "edit_email" })}
                  >
                    Edit
                  </button>
                ) : null}
              </div>

              <CodeInput
                value={flow.code}
                disabled={working || !emailAvailable}
                invalid={Boolean(flow.failure)}
                inputRef={codeRef}
                onChange={(next) => dispatch({ type: "code_changed", code: next })}
              />

              <p className={expired ? "signin-expiry expired" : "signin-expiry"}>
                {expired
                  ? "This code is no longer valid. Send a new one."
                  : `Expires in ${formatCountdown(codeSeconds)}.`}
              </p>

              <button className="signin-submit" disabled={!submitReady || working}>
                {busy === "verifying" ? "Verifying…" : "Verify and continue"}
              </button>

              <div className="signin-footer-modes">
                <button
                  type="button"
                  className="signin-link"
                  disabled={!resendReady || working || !emailAvailable}
                  onClick={() => void resend()}
                >
                  {resendReady
                    ? busy === "resending"
                      ? "Sending…"
                      : "Send a new code"
                    : `Resend in ${formatCooldown(resendSeconds)}`}
                </button>
                {flow.channel === "email-2fa" ? (
                  <button
                    type="button"
                    className="signin-link"
                    disabled={working}
                    onClick={() =>
                      void signOutAndRedirect(`/signin?next=${encodeURIComponent(resolvedNext)}`)
                    }
                  >
                    Use another account
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </div>

        {flow.failure ? (
          <p className="signin-status error" role="alert">
            {flow.failure.message}
          </p>
        ) : flow.notice ? (
          <p className="signin-status" role="status">
            {flow.notice}
          </p>
        ) : null}

        {oauthMessage ? (
          <p className="signin-status error" role="alert">
            {oauthMessage}
          </p>
        ) : null}

        {hint ? (
          <div className="signin-setup-shell" role="status">
            <span>invite only</span>
            <strong>No code in your inbox?</strong>
            <p>{hint}</p>
          </div>
        ) : null}

        <div className="signin-footer">
          {flow.step === "identity" && status.passwordSignInAvailable ? (
            <div className="signin-footer-modes">
              {passwordPanel === "closed" ? (
                <button
                  type="button"
                  className="signin-link"
                  onClick={() => {
                    setPasswordMessage("");
                    setPasswordPanel("password");
                  }}
                >
                  Use a password instead
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="signin-link"
                    onClick={() => {
                      setPasswordPanel("closed");
                      setResetSent(false);
                      setPassword("");
                      setPasswordMessage("");
                    }}
                  >
                    Back to email codes
                  </button>
                  {passwordPanel === "password" ? (
                    <button
                      type="button"
                      className="signin-link"
                      onClick={() => {
                        setPasswordMessage("");
                        setResetSent(false);
                        setPasswordPanel("reset");
                      }}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          <AccessFooter />
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7 12.9 19.6C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.5 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.4 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1.1 6.2 5.2C39.3 37.2 44 32 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
