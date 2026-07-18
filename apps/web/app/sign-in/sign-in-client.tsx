"use client";

import { useEffect, useState } from "react";
import { VantageLogo } from "../../components/brand";

const WAITLIST_ONLY_MESSAGE =
  "Vantage is waitlist-only right now. Join the waitlist for access, or sign in with an authorized account.";

type AuthStatus = {
  waitlistOnly: true;
  publicSignup: false;
  databaseConfigured: boolean;
  emailOtpAvailable: boolean;
  email2faEnforced: boolean;
  email2faBypassEnabled: boolean;
  passwordSignInAvailable: boolean;
  googleSignInAvailable: boolean;
  emailOtpReason: string | null;
  passwordReason: string | null;
  ownerEmailHint: string;
};

function oauthErrorMessage(code: string | null) {
  if (!code) return "";
  const normalized = code.toLowerCase();
  if (
    normalized.includes("signup") ||
    normalized.includes("unable_to_create") ||
    normalized.includes("user_not_found") ||
    normalized.includes("access_denied") ||
    normalized.includes("waitlist")
  ) {
    return WAITLIST_ONLY_MESSAGE;
  }
  return "Google sign-in could not be completed. If you already have access, try again or use email and password.";
}

async function destinationAfterAuth(nextPath: string) {
  const onboarding = await fetch("/api/onboarding");
  if (onboarding.ok) {
    const state = (await onboarding.json()) as { complete?: boolean; accessStatus?: string };
    return state.complete && state.accessStatus === "approved" ? nextPath : "/onboarding";
  }
  return nextPath;
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
  /** password | email-otp (first factor) | reset */
  const [mode, setMode] = useState<"password" | "email-otp" | "reset">("password");
  const [otpSent, setOtpSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifyStep, setVerifyStep] = useState(false);
  const [emailHint, setEmailHint] = useState("");

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
          void fetch("/api/auth/email-2fa", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "request" }),
          }).then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) setMessage(payload.error ?? "Could not send verification email.");
            else setMessage("Enter the code we emailed you to finish signing in.");
          });
        })
        .catch(() => undefined);
    }
  }, [nextPath]);

  async function continueAfterFirstFactor() {
    const elev = await fetch("/api/auth/email-2fa");
    if (!elev.ok) {
      window.location.assign(nextPath);
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
        setMessage(payload.error ?? status.emailOtpReason ?? "Could not send verification email.");
        return;
      }
      setMessage("Enter the code we emailed you to finish signing in.");
      return;
    }
    window.location.assign(await destinationAfterAuth(nextPath));
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (!status.passwordSignInAvailable) {
      setMessage(status.passwordReason ?? "Password sign-in is unavailable until the database is configured.");
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
      setMessage(WAITLIST_ONLY_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function emailOtpSignIn(event: React.FormEvent) {
    event.preventDefault();
    if (!status.emailOtpAvailable) {
      setMessage(
        status.emailOtpReason ??
          "Email code sign-in requires RESEND_API_KEY and AUTH_EMAIL_FROM on the Vercel project.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!otpSent) {
        const response = await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(
            typeof payload.message === "string"
              ? payload.message
              : status.emailOtpReason ?? "Could not send a sign-in code.",
          );
          return;
        }
        setOtpSent(true);
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
      setMessage(WAITLIST_ONLY_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!status.googleSignInAvailable && !googleEnabled) return;
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
      setMessage(response.ok ? "A new code is on the way." : data.error ?? "Could not resend code.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!status.emailOtpAvailable) {
      setMessage(status.emailOtpReason ?? "Password reset by email is unavailable until email delivery is configured.");
      return;
    }
    setBusy(true);
    try {
      if (!resetSent) {
        await fetch("/api/auth/email-otp/request-password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setResetSent(true);
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
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "password" | "email-otp" | "reset") {
    setMode(next);
    setMessage("");
    setOtpSent(false);
    setResetSent(false);
    setCode("");
  }

  const googleReady = status.googleSignInAvailable || googleEnabled;

  if (verifyStep) {
    return (
      <main className="signin-page">
        <section className="signin-card" aria-labelledby="signin-title">
          <div className="signin-brand">
            <VantageLogo />
          </div>
          <h1 id="signin-title">Check your email</h1>
          <p className="signin-sub">
            Default 2FA: enter the one-time code we sent{emailHint ? ` to ${emailHint}` : ""}. Password or Google was
            only the first step.
          </p>
          {!status.emailOtpAvailable ? (
            <p className="signin-status" role="status">
              {status.emailOtpReason ??
                "Email 2FA requires RESEND_API_KEY and AUTH_EMAIL_FROM on the Vercel project."}
            </p>
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
              </label>
              <button className="signin-submit" disabled={busy}>
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
            <button type="button" className="signin-link" disabled={busy || !status.emailOtpAvailable} onClick={() => void resendCode()}>
              Resend code
            </button>
            <button
              type="button"
              className="signin-link"
              onClick={() => {
                setVerifyStep(false);
                setCode("");
                setMessage("");
              }}
            >
              Back to sign in
            </button>
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
        <h1 id="signin-title">Welcome to Vantage</h1>
        <p className="signin-sub">
          {status.email2faEnforced
            ? "Password or Google, then an email code. Or sign in with an email code alone."
            : status.emailOtpAvailable
              ? "Sign in with password, Google, or an email code."
              : "Sign in to continue"}
        </p>

        {googleReady ? (
          <button className="signin-google" type="button" onClick={google} disabled={busy}>
            <GoogleMark />
            Continue with Google
          </button>
        ) : (
          <button className="signin-google disabled" type="button" disabled aria-disabled="true">
            <GoogleMark />
            Continue with Google
            <em>Coming soon</em>
          </button>
        )}

        <div className="signin-or" role="separator">
          <span>OR</span>
        </div>

        {mode === "password" ? (
          <form className="signin-form" onSubmit={(event) => void passwordSignIn(event)}>
            <label>
              Email
              <span className="signin-field">
                <MailIcon />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </label>
            <label>
              Password
              <span className="signin-field">
                <LockIcon />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </span>
            </label>
            <button className="signin-submit" disabled={busy || !status.passwordSignInAvailable}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : null}

        {mode === "email-otp" ? (
          <form className="signin-form" onSubmit={(event) => void emailOtpSignIn(event)}>
            <label>
              Email
              <span className="signin-field">
                <MailIcon />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </label>
            {otpSent ? (
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
              </label>
            ) : null}
            {!status.emailOtpAvailable ? (
              <p className="signin-status" role="status">
                {status.emailOtpReason ??
                  "Email code sign-in requires RESEND_API_KEY and AUTH_EMAIL_FROM on the Vercel project."}
              </p>
            ) : null}
            <button className="signin-submit" disabled={busy || !status.emailOtpAvailable}>
              {busy ? "Working…" : otpSent ? "Verify code" : "Email me a code"}
            </button>
          </form>
        ) : null}

        {mode === "reset" ? (
          <form className="signin-form" onSubmit={(event) => void resetPassword(event)}>
            <label>
              Email
              <span className="signin-field">
                <MailIcon />
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </span>
            </label>
            {resetSent && (
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
                      type="password"
                      minLength={12}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </span>
                </label>
              </>
            )}
            {!status.emailOtpAvailable ? (
              <p className="signin-status" role="status">
                {status.emailOtpReason}
              </p>
            ) : null}
            <button className="signin-submit" disabled={busy || !status.emailOtpAvailable}>
              {resetSent ? "Reset password" : "Send reset code"}
            </button>
          </form>
        ) : null}

        {!status.passwordSignInAvailable && mode === "password" ? (
          <p className="signin-status" role="status">
            {status.passwordReason}
          </p>
        ) : null}
        {status.email2faEnforced === false && status.emailOtpReason && mode === "password" ? (
          <p className="signin-status" role="status">
            Email 2FA not enforced yet: {status.emailOtpReason}
          </p>
        ) : null}
        {message ? (
          <p className="signin-status" role="status">
            {message}
          </p>
        ) : null}

        <div className="signin-footer">
          {mode === "password" ? (
            <>
              <button type="button" className="signin-link" onClick={() => switchMode("email-otp")}>
                Sign in with email code
              </button>
              <button type="button" className="signin-link" onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            </>
          ) : (
            <button type="button" className="signin-link" onClick={() => switchMode("password")}>
              Back to password sign in
            </button>
          )}
          <a className="signin-link" href="/#waitlist">
            Need access? <strong>Join waitlist</strong>
          </a>
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7 12.9 19.6C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.5 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.4 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1.1 6.2 5.2C39.3 37.2 44 32 44 24c0-1.3-.1-2.7-.4-3.5z" />
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
