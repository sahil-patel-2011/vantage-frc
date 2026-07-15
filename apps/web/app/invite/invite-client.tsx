"use client";

import { useState } from "react";

export default function InviteClient({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  async function accept() {
    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Membership activated. Your workspace is ready." : data.error);
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">VANTAGE / TEAM INVITE</span>
        <h1>Accept your invitation</h1>
        <p>Sign in using the exact verified email address that received this invite.</p>
        <button className="primary-action" disabled={!token} onClick={accept}>Accept invitation</button>
        {!token && <p className="auth-message">This invitation link is incomplete.</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  );
}
