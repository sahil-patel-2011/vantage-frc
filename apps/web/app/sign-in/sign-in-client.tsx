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
  const [showReset, setShowReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState("");

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
  }, []);

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
        window.location.assign(nextPath);
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
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: nextPath,
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
        setShowReset(false);
        setResetSent(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const googleReady = status.googleSignInAvailable || googleEnabled;

  return (
    <main className="signin-page">
      <section className="signin-card" aria-labelledby="signin-title">
        <div className="signin-brand">
          <VantageLogo />
        </div>
        <h1 id="signin-title">Welcome to Vantage</h1>
        <p className="signin-sub">Sign in to continue</p>

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

        {!showReset ? (
          <form className="signin-form" onSubmit={passwordSignIn}>
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
        ) : (
          <form className="signin-form" onSubmit={resetPassword}>
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
            <button className="signin-submit" disabled={busy || !status.emailOtpAvailable}>
              {resetSent ? "Reset password" : "Send reset code"}
            </button>
          </form>
        )}

        {!status.passwordSignInAvailable && (
          <p className="signin-status" role="status">
            {status.passwordReason}
          </p>
        )}
        {message && (
          <p className="signin-status" role="status">
            {message}
          </p>
        )}

        <div className="signin-footer">
          <button
            type="button"
            className="signin-link"
            onClick={() => {
              setShowReset((value) => !value);
              setMessage("");
              setResetSent(false);
            }}
          >
            {showReset ? "Back to sign in" : "Forgot password?"}
          </button>
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
