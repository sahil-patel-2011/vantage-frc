"use client";

import { useEffect, useState } from "react";
import { VantageLogo } from "../../components/brand";
import {
  SIGN_IN_FAILED_MESSAGE,
  WAITLIST_ONLY_MESSAGE,
  emailOtpSetupRequired,
  googleReady as isGoogleReady,
  oauthErrorMessage,
  passwordSetupRequired,
  publicEmailUnavailableCopy,
  publicPasswordUnavailableCopy,
  raisedPricingStrip,
  signInAccessNote,
  signInNextActions,
  signInProgressLabel,
  signInSetupCopy,
  signInSubtitle,
  type SignInAuthStatus,
  type SignInMode,
} from "../../lib/sign-in";
import { safeAppPath } from "../../lib/security/safe-navigation";
import "./sign-in-flow.css";

type AuthStatus = SignInAuthStatus;

async function destinationAfterAuth(nextPath: string) {
  const safeNext = safeAppPath(nextPath, "/dashboard");
  const onboarding = await fetch("/api/onboarding");
  if (onboarding.ok) {
    const state = (await onboarding.json()) as { complete?: boolean; accessStatus?: string };
    return state.complete && state.accessStatus === "approved"
      ? safeNext
      : `/onboarding?next=${encodeURIComponent(safeNext)}`;
  }
  return safeNext;
}

function codeExpiry(seconds = 300) {
  return Date.now() + Math.max(30, seconds) * 1_000;
}

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

let callbackCodeRequest: Promise<{ ok: boolean; payload: Record<string, unknown> }> | null = null;
function requestCallbackVerificationCode() {
  if (!callbackCodeRequest) {
    callbackCodeRequest = fetch("/api/auth/email-2fa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request" }),
    }).then(async (response) => ({
      ok: response.ok,
      payload: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    }));
  }
  return callbackCodeRequest;
}

function SetupShell({
  kind,
  status,
}: {
  kind: "email_otp" | "google" | "password" | "database";
  status?: Pick<AuthStatus, "emailOtpReason" | "passwordReason">;
}) {
  const copy = signInSetupCopy(kind, status);
  return (
    <div className="signin-setup-shell" role="status">
      <span>{copy.badge}</span>
      <strong>{copy.title}</strong>
      <p>{copy.description}</p>
    </div>
  );
}

function AccessFooter() {
  const actions = signInNextActions();
  const prices = raisedPricingStrip();
  return (
    <div className="signin-cta-block">
      <p>Need access? Join the waitlist or review raised plans — sign-in never invents membership.</p>
      <div className="signin-cta-row">
        {actions.map((action) => (
          <a key={action.id} className={action.primary ? "primary" : undefined} href={action.href}>
            {action.label}
          </a>
        ))}
      </div>
      <ul className="signin-price-strip" aria-label="Raised monthly plan prices">
        {prices.map((item) => (
          <li key={item.id}>
            <span>{item.label}</span>
            <strong>{item.price}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SignInMode>("password");
  const [otpSent, setOtpSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifyStep, setVerifyStep] = useState(false);
  const [emailHint, setEmailHint] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!codeExpiresAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [codeExpiresAt]);

  const secondsLeft = codeExpiresAt ? Math.max(0, Math.ceil((codeExpiresAt - clock) / 1_000)) : 0;
  const codeExpired = Boolean(codeExpiresAt && secondsLeft === 0);
  const resendCoolingDown = secondsLeft > 270;

  function beginCodeTimer(seconds?: number) {
    setClock(Date.now());
    setCodeExpiresAt(codeExpiry(seconds));
  }

  useEffect(() => {
    void fetch("/api/auth/status")
      .then(async (response) => (response.ok ? ((await response.json()) as AuthStatus) : null))
      .then((value) => {
        if (value) setStatus(value);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setMessage(oauthErrorMessage(error));
    if (params.get("verify") === "1") {
      setVerifyStep(true);
      void fetch("/api/auth/email-2fa")
        .then(async (response) => (response.ok ? await response.json() : null))
        .then(async (data) => {
          if (!data) return;
          if (!data.requiresVerification) {
            window.location.assign(await destinationAfterAuth(nextPath));
            return;
          }
          setEmailHint(data.emailHint ?? "");
          void requestCallbackVerificationCode().then(({ ok, payload }) => {
            if (!ok) {
              setMessage(
                typeof payload.error === "string"
                  ? publicEmailUnavailableCopy(payload.error)
                  : publicEmailUnavailableCopy(status.emailOtpReason),
              );
            } else {
              beginCodeTimer(Number(payload.expiresInSeconds ?? 300));
              setMessage("Enter the code we emailed you to finish signing in.");
            }
          });
        })
        .catch(() => undefined);
    }
  }, [nextPath]);

  async function continueAfterFirstFactor() {
    const elev = await fetch("/api/auth/email-2fa");
    if (!elev.ok) {
      window.location.assign(safeAppPath(nextPath, "/dashboard"));
      return;
    }
    const data = await elev.json();
    if (data.requiresVerification) {
      setVerifyStep(true);
      setEmailHint(data.emailHint ?? "");
      const sent = await fetch("/api/auth/email-2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const payload = await sent.json().catch(() => ({}));
      if (!sent.ok) {
        setMessage(publicEmailUnavailableCopy(payload.error ?? status.emailOtpReason));
        return;
      }
      beginCodeTimer(Number(payload.expiresInSeconds ?? 300));
      setMessage("Enter the code we emailed you to finish signing in.");
      return;
    }
    window.location.assign(await destinationAfterAuth(nextPath));
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (!status.passwordSignInAvailable) {
      setMessage(publicPasswordUnavailableCopy(status.passwordReason));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        await continueAfterFirstFactor();
        return;
      }
      setMessage(SIGN_IN_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function emailOtpSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (!status.emailOtpAvailable) {
      setMessage(publicEmailUnavailableCopy(status.emailOtpReason));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!otpSent || codeExpired) {
        const response = await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(
            typeof payload.message === "string"
              ? publicEmailUnavailableCopy(payload.message)
              : publicEmailUnavailableCopy(status.emailOtpReason),
          );
          return;
        }
        setOtpSent(true);
        setCode("");
        beginCodeTimer(300);
        setMessage("If that email is authorized, a 6-digit sign-in code is on the way.");
        return;
      }
      const response = await fetch("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      if (response.ok) {
        // First-factor email OTP already proves mailbox control — skip second-factor step.
        window.location.assign(await destinationAfterAuth(nextPath));
        return;
      }
      setMessage(SIGN_IN_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!isGoogleReady(status, googleEnabled)) return;
    setBusy(true);
    setMessage("");
    try {
      const callbackURL = status.email2faEnforced
        ? `/signin?verify=1&next=${encodeURIComponent(nextPath)}`
        : nextPath;
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL,
          errorCallbackURL: `/signin?next=${encodeURIComponent(nextPath)}`,
        }),
      });
      const data = (await response.json()) as { url?: string; message?: string; error?: string };
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setMessage(oauthErrorMessage(data.error ?? data.message ?? "signup_disabled") || WAITLIST_ONLY_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail2fa(event: React.FormEvent) {
    event.preventDefault();
    if (codeExpired) {
      setMessage("That code expired. Request a new code to continue.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "That code is incorrect or expired.");
        return;
      }
      window.location.assign(await destinationAfterAuth(nextPath));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = await response.json();
      if (response.ok) {
        beginCodeTimer(Number(data.expiresInSeconds ?? 300));
        setCode("");
      }
      setMessage(
        response.ok
          ? "A new code is on the way."
          : publicEmailUnavailableCopy(data.error ?? status.emailOtpReason),
      );
    } finally {
      setBusy(false);
    }
  }

  async function restartSignIn() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign(`/signin?next=${encodeURIComponent(safeAppPath(nextPath, "/dashboard"))}`);
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!status.emailOtpAvailable) {
      setMessage(publicEmailUnavailableCopy(status.emailOtpReason));
      return;
    }
    setBusy(true);
    try {
      if (!resetSent || codeExpired) {
        await fetch("/api/auth/email-otp/request-password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setResetSent(true);
        setPassword("");
        setCode("");
        beginCodeTimer(300);
        setMessage("If the authorized account exists, a short-lived reset code is on the way.");
        return;
      }
      const response = await fetch("/api/auth/email-otp/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp: code, password }),
      });
      setMessage(
        response.ok
          ? "Password updated. Existing sessions were revoked."
          : "That reset code is invalid, expired, or has reached its attempt limit.",
      );
      if (response.ok) {
        setMode("password");
        setResetSent(false);
        setCode("");
        setPassword("");
        setShowPassword(false);
        setCodeExpiresAt(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: SignInMode) {
    setMode(next);
    setMessage("");
    setOtpSent(false);
    setResetSent(false);
    setCode("");
    setPassword("");
    setShowPassword(false);
    setCapsLock(false);
    setCodeExpiresAt(null);
  }

  const googleReady = isGoogleReady(status, googleEnabled);
  const accessNote = signInAccessNote();
  const activeStep: 1 | 2 = otpSent || resetSent || verifyStep ? 2 : 1;

  if (verifyStep) {
    return (
      <main className="signin-page">
        <section className="signin-card" aria-labelledby="signin-title">
          <div className="signin-brand">
            <VantageLogo />
          </div>
          <span className="signin-eyebrow">SECURE SIGN-IN</span>
          <p className="signin-progress-label">{signInProgressLabel(2)}</p>
          <SignInProgress active={2} />
          <h1 id="signin-title">Check your email</h1>
          <p className="signin-sub">
            Default 2FA: enter the one-time code we sent{emailHint ? ` to ${emailHint}` : ""}. Google or password was
            only the first factor.
          </p>
          {emailOtpSetupRequired(status) ? (
            <SetupShell kind="email_otp" status={status} />
          ) : (
            <form className="signin-form" onSubmit={(event) => void verifyEmail2fa(event)}>
              <label>
                Verification code
                <span className="signin-field">
                  <LockIcon />
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </span>
                {codeExpiresAt ? (
                  <small className={codeExpired ? "signin-expiry expired" : "signin-expiry"}>
                    {codeExpired ? "Code expired — request a new one." : `Code expires in ${timeLabel(secondsLeft)}.`}
                  </small>
                ) : null}
              </label>
              <button className="signin-submit" disabled={busy || code.length !== 6 || codeExpired}>
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
            </form>
          )}
          {message ? (
            <p className="signin-status" role="status">
              {message}
            </p>
          ) : null}
          <div className="signin-footer">
            <div className="signin-footer-modes">
              <button
                type="button"
                className="signin-link"
                disabled={busy || emailOtpSetupRequired(status) || resendCoolingDown}
                onClick={() => void resendCode()}
              >
                {resendCoolingDown ? `Resend in ${secondsLeft - 270}s` : "Resend code"}
              </button>
              <button type="button" className="signin-link" disabled={busy} onClick={() => void restartSignIn()}>
                Use another account
              </button>
            </div>
            <AccessFooter />
          </div>
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
        <span className="signin-eyebrow">SECURE SIGN-IN</span>
        <p className="signin-progress-label">{signInProgressLabel(activeStep)}</p>
        <SignInProgress active={activeStep} />
        <h1 id="signin-title">Welcome to Vantage</h1>
        <p className="signin-sub">{signInSubtitle(status)}</p>
        <p className="signin-access-note">
          <b className="signin-access-mark" aria-hidden="true">
            ✓
          </b>
          <span>
            <b>{accessNote.title}</b>
            {accessNote.body}
          </span>
        </p>

        <div className="signin-method-panel">
          <p className="signin-method-heading">
            <span>METHOD · GOOGLE</span>
            <strong>One tap when Google OAuth is configured</strong>
          </p>
          {googleReady ? (
            <button className="signin-google" type="button" onClick={google} disabled={busy}>
              <GoogleMark />
              Continue with Google
            </button>
          ) : (
            <>
              <SetupShell kind="google" />
              <button className="signin-google disabled" type="button" disabled aria-disabled="true">
                <GoogleMark />
                Continue with Google
                <em>setup_required</em>
              </button>
            </>
          )}
        </div>

        <div className="signin-or" role="separator">
          <span>OR EMAIL</span>
        </div>

        {mode !== "reset" ? (
          <div className="signin-method-tabs" role="tablist" aria-label="Email sign-in method">
            <button
              type="button"
              role="tab"
              aria-pressed={mode === "password"}
              onClick={() => switchMode("password")}
            >
              Password
            </button>
            <button
              type="button"
              role="tab"
              aria-pressed={mode === "email-otp"}
              onClick={() => switchMode("email-otp")}
            >
              Email code
            </button>
          </div>
        ) : null}

        {mode === "password" ? (
          <div className="signin-method-panel">
            <p className="signin-method-heading">
              <span>METHOD · PASSWORD</span>
              <strong>
                {status.email2faEnforced
                  ? "Email + password, then an email verification code"
                  : "Email + password for authorized accounts"}
              </strong>
            </p>
            {passwordSetupRequired(status) ? <SetupShell kind="password" status={status} /> : null}
            <form className="signin-form" onSubmit={(event) => void passwordSignIn(event)}>
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
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setEmail((value) => value.trim().toLowerCase())}
                  />
                </span>
              </label>
              <label>
                Password
                <span className="signin-field">
                  <LockIcon />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                    onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                  />
                  <button
                    type="button"
                    className="signin-password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
                {capsLock ? <small className="signin-expiry expired">Caps Lock is on.</small> : null}
              </label>
              <button className="signin-submit" disabled={busy || !status.passwordSignInAvailable}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
        ) : null}

        {mode === "email-otp" ? (
          <div className="signin-method-panel">
            <p className="signin-method-heading">
              <span>METHOD · EMAIL OTP</span>
              <strong>6-digit code to your authorized mailbox — no password</strong>
            </p>
            {emailOtpSetupRequired(status) ? <SetupShell kind="email_otp" status={status} /> : null}
            <form className="signin-form" onSubmit={(event) => void emailOtpSignIn(event)}>
              <label>
                Email
                <span className="signin-field">
                  <MailIcon />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setEmail((value) => value.trim().toLowerCase())}
                    disabled={emailOtpSetupRequired(status)}
                  />
                </span>
              </label>
              {otpSent && !codeExpired ? (
                <label>
                  Sign-in code
                  <span className="signin-field">
                    <LockIcon />
                    <input
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoComplete="one-time-code"
                      autoFocus
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    />
                  </span>
                  <small className="signin-expiry">Code expires in {timeLabel(secondsLeft)}.</small>
                </label>
              ) : null}
              {otpSent && codeExpired ? (
                <p className="signin-status">That sign-in code expired. Send a new code to continue.</p>
              ) : null}
              <button
                className="signin-submit"
                disabled={
                  busy ||
                  emailOtpSetupRequired(status) ||
                  (otpSent && !codeExpired && code.length !== 6)
                }
              >
                {busy
                  ? "Working…"
                  : otpSent && !codeExpired
                    ? "Verify code"
                    : codeExpired
                      ? "Send a new code"
                      : "Email me a code"}
              </button>
              {otpSent ? (
                <button
                  type="button"
                  className="signin-link signin-inline-link"
                  onClick={() => {
                    setOtpSent(false);
                    setCode("");
                    setCodeExpiresAt(null);
                    setMessage("");
                  }}
                >
                  Use a different email
                </button>
              ) : null}
            </form>
          </div>
        ) : null}

        {mode === "reset" ? (
          <div className="signin-method-panel">
            <p className="signin-method-heading">
              <span>METHOD · RESET</span>
              <strong>Email a short-lived reset code to an authorized account</strong>
            </p>
            {emailOtpSetupRequired(status) ? <SetupShell kind="email_otp" status={status} /> : null}
            <form className="signin-form" onSubmit={(event) => void resetPassword(event)}>
              <label>
                Email
                <span className="signin-field">
                  <MailIcon />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmail((value) => value.trim().toLowerCase())}
                    disabled={emailOtpSetupRequired(status)}
                  />
                </span>
              </label>
              {resetSent && !codeExpired ? (
                <>
                  <label>
                    Reset code
                    <span className="signin-field">
                      <LockIcon />
                      <input
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      />
                    </span>
                  </label>
                  <label>
                    New password
                    <span className="signin-field">
                      <LockIcon />
                      <input
                        type={showPassword ? "text" : "password"}
                        minLength={12}
                        required
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="signin-password-toggle"
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </span>
                    <small className="signin-expiry">
                      Use 12+ characters and a password you do not reuse elsewhere.
                    </small>
                  </label>
                </>
              ) : null}
              {resetSent ? (
                <small className={codeExpired ? "signin-expiry expired" : "signin-expiry"}>
                  {codeExpired ? "Reset code expired." : `Reset code expires in ${timeLabel(secondsLeft)}.`}
                </small>
              ) : null}
              <button
                className="signin-submit"
                disabled={
                  busy ||
                  emailOtpSetupRequired(status) ||
                  (resetSent && !codeExpired && (code.length !== 6 || password.length < 12))
                }
              >
                {resetSent && !codeExpired
                  ? "Reset password"
                  : codeExpired
                    ? "Send a new reset code"
                    : "Send reset code"}
              </button>
            </form>
          </div>
        ) : null}

        {status.email2faEnforced === false && status.emailOtpReason && mode === "password" ? (
          <p className="signin-status" role="status">
            Email 2FA not enforced yet: {publicEmailUnavailableCopy(status.emailOtpReason)}
          </p>
        ) : null}
        {message ? (
          <p className="signin-status" role="status">
            {message}
          </p>
        ) : null}

        <div className="signin-footer">
          <div className="signin-footer-modes">
            {mode === "password" ? (
              <button type="button" className="signin-link" onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            ) : mode === "email-otp" ? (
              <button type="button" className="signin-link" onClick={() => switchMode("password")}>
                Back to password sign in
              </button>
            ) : (
              <button type="button" className="signin-link" onClick={() => switchMode("password")}>
                Back to password sign in
              </button>
            )}
          </div>
          <AccessFooter />
        </div>
      </section>
    </main>
  );
}

function SignInProgress({ active }: { active: 1 | 2 }) {
  return (
    <ol className="signin-progress" aria-label="Account setup progress">
      <li className="active" aria-current={active === 1 ? "step" : undefined}>
        <b>{active > 1 ? "✓" : "1"}</b>
        <span>Identity</span>
      </li>
      <li className={active >= 2 ? "active" : undefined} aria-current={active === 2 ? "step" : undefined}>
        <b>2</b>
        <span>Verify</span>
      </li>
      <li>
        <b>3</b>
        <span>Team setup</span>
      </li>
    </ol>
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
