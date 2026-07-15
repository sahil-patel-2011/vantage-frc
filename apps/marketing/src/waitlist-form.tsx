"use client";

import { FormEvent, useState } from "react";
import { track } from "./analytics";

export function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    const form = new FormData(event.currentTarget);
    const body = {
      email: form.get("email"),
      teamNumber: form.get("teamNumber"),
      phone: form.get("phone"),
      smsConsent: form.get("smsConsent") === "on",
      website: form.get("website")
    };
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json() as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message ?? "Submission failed");
      setState("success");
      track("waitlist_success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="confirmation" role="status" tabIndex={-1}>
        <span className="signal">SIGNAL RECEIVED</span>
        <h3>You’re on the list.</h3>
        <p>We’ll email launch news. Joining does not create a Vantage account or team organization.</p>
      </div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={submit} aria-label="Join the Vantage waitlist">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="teamNumber">FRC team number</label>
        <input id="teamNumber" name="teamNumber" type="number" min="1" max="99999" inputMode="numeric" required />
      </div>
      <div className="field">
        <label htmlFor="phone">Phone <span>optional</span></label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+12025550123" />
      </div>
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="consent">
        <input name="smsConsent" type="checkbox" />
        <span>
          I agree to receive occasional Vantage launch texts at the number provided. Consent is not a
          condition of access. Message/data rates may apply. Reply STOP to opt out. No texts are sent yet.
        </span>
      </label>
      <p className="form-note">
        Email is used for waitlist and launch updates. Read our <a href="/privacy">privacy notice</a>.
      </p>
      {state === "error" && <p className="form-error" role="alert">{message}</p>}
      <button className="button primary" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Transmitting…" : "Join the waitlist"}
      </button>
    </form>
  );
}
