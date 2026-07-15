"use client";

import { useState } from "react";

export default function SignInClient({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    });
    setSent(true);
    setMessage("If the address can receive a Vantage code, it is on the way.");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, otp: code }),
    });
    if (response.ok) window.location.assign("/");
    else setMessage("That code is invalid, expired, or has reached its attempt limit.");
  }

  async function google() {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });
    const data = await response.json();
    if (data.url) window.location.assign(data.url);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">VANTAGE / SECURE ACCESS</span>
        <h1>Sign in to your team workspace</h1>
        <p>Membership is invite-only. Signing in does not automatically join a team.</p>
        {googleEnabled && <button className="google-button" onClick={google}>Continue with Google</button>}
        <div className="auth-divider"><span>or use a one-time code</span></div>
        {!sent ? (
          <form onSubmit={requestCode}>
            <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="primary-action">Send numeric code</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label>6-digit code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            <button className="primary-action">Verify and sign in</button>
            <button type="button" className="text-button" onClick={() => setSent(false)}>Use another email</button>
          </form>
        )}
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  );
}
