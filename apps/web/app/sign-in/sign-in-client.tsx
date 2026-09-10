"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_CODE_TTL_SECONDS,
  SIGN_IN_FAILED_MESSAGE,
  WAITLIST_ONLY_MESSAGE,
  canResendCode,
  canSubmitCode,
  classifyOtpFailure,
  clearRememberedAccount,
  codeSecondsRemaining,
  emailOtpSetupRequired,
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
} from "../../lib/sign-in";
import { inviteJoiningHeadline, type InvitePreview } from "../../lib/invite";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { signOutAndRedirect } from "../../lib/sign-out";
import {
  AccessFooter,
  InviteBanner,
  SetupShell,
  SignInCard,
  SignInStatusBlock,
} from "./sign-in-chrome";
import { SignInCodeStep } from "./sign-in-code-step";
import { SignInIdentityStep, SignInPasswordFooter } from "./sign-in-identity";
import {
  readOnboardingGate,
  sessionProbeFromPayload,
  storedInviteTokenFrom,
  type PasswordPanel,
  type SessionProbe,
  type SignInBusy,
} from "./sign-in-model";
import { SignInSessionView } from "./sign-in-session";
import "../product-styles";
import "./sign-in-flow.css";

type AuthStatus = SignInAuthStatus;

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
  const [busy, setBusy] = useState<SignInBusy>("idle");
  const [oauthMessage, setOauthMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [probe, setProbe] = useState<SessionProbe>({ state: "checking" });
  const [remembered, setRemembered] = useState<RememberedAccount>({ email: null, method: null });
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [resolvedNext, setResolvedNext] = useState(() => safeAppPath(nextPath, "/dashboard"));
  const [passwordPanel, setPasswordPanel] = useState<PasswordPanel>("closed");
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

  async function submitIdentity(event: FormEvent) {
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

  async function passwordSignIn(event: FormEvent) {
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

  async function requestPasswordReset(event: FormEvent) {
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

  const preferred = useMemo(
    () => preferredSignInMethod(remembered, { google: googleAvailable, email: emailAvailable }),
    [remembered, googleAvailable, emailAvailable],
  );

  const hint = invitedOnlyHint(flow);
  const working = busy !== "idle";

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
      />
    );
  }

  return (
    <SignInCard titleId="signin-title" title={stepCopy.title} subtitle={stepCopy.sub}>
      <InviteBanner token={inviteToken} headline={inviteHeadline} preview={invitePreview} />
      {unavailable ? <SetupShell copy={unavailable} /> : null}

      <div className="signin-step">
        {flow.step === "identity" ? (
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
            resetSent={resetSent}
            password={password}
            passwordMessage={passwordMessage}
            code={flow.code}
            codeRef={codeRef}
            onGoogle={() => void google()}
            onSubmitIdentity={(event) => void submitIdentity(event)}
            onEmailChange={(email) => dispatch({ type: "email_changed", email })}
            onEmailBlur={(email) =>
              dispatch({ type: "email_changed", email: normalizeSignInEmail(email) })
            }
            onForgetAccount={forgetAccount}
            onPasswordSubmit={(event) =>
              void (passwordPanel === "reset" ? requestPasswordReset(event) : passwordSignIn(event))
            }
            onPasswordChange={setPassword}
            onCodeChange={(code) => dispatch({ type: "code_changed", code })}
          />
        ) : (
          <SignInCodeStep
            channel={flow.channel}
            email={flow.email}
            emailHint={flow.emailHint}
            code={flow.code}
            codeRef={codeRef}
            emailAvailable={emailAvailable}
            invalid={Boolean(flow.failure)}
            expired={expired}
            codeSeconds={codeSeconds}
            resendReady={resendReady}
            resendSeconds={resendSeconds}
            submitReady={submitReady}
            busy={busy}
            working={working}
            resolvedNext={resolvedNext}
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
            onCodeChange={(code) => dispatch({ type: "code_changed", code })}
            onEditEmail={() => dispatch({ type: "edit_email" })}
            onResend={() => void resend()}
            onSwitchAccount={(href) => void signOutAndRedirect(href)}
          />
        )}
      </div>

      <SignInStatusBlock
        failure={flow.failure?.message ?? null}
        notice={flow.notice}
        oauthMessage={oauthMessage}
        inviteHint={hint}
      />

      <div className="signin-footer">
        <SignInPasswordFooter
          passwordSignInAvailable={status.passwordSignInAvailable}
          identityStep={flow.step === "identity"}
          passwordPanel={passwordPanel}
          onUsePassword={() => {
            setPasswordMessage("");
            setPasswordPanel("password");
          }}
          onBackToCodes={() => {
            setPasswordPanel("closed");
            setResetSent(false);
            setPassword("");
            setPasswordMessage("");
          }}
          onForgotPassword={() => {
            setPasswordMessage("");
            setResetSent(false);
            setPasswordPanel("reset");
          }}
        />
        <AccessFooter />
      </div>
    </SignInCard>
  );
}
