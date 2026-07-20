"use client";

import { type FormEvent, useId, useState } from "react";
import { raisedPricingSummaryLine } from "@vantage/billing/catalog";
import { LegalAgreementCheckbox } from "../legal-agreement-checkbox";
import { track } from "../../lib/marketing/analytics";

type FormState = "idle" | "sending" | "success" | "error";

export function WaitlistForm({
  idPrefix = "waitlist",
  compact = false,
}: {
  idPrefix?: string;
  compact?: boolean;
}) {
  const reactId = useId();
  const prefix = idPrefix || reactId.replace(/:/g, "");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [phone, setPhone] = useState("");

  const phoneProvided = phone.trim().length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted) {
      setState("error");
      setMessage("Agree to the Terms of Service and Privacy Policy to join.");
      return;
    }

    setState("sending");
    setMessage("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          teamNumber: form.get("teamNumber"),
          phone: form.get("phone"),
          smsConsent: phoneProvided && form.get("smsConsent") === "on",
          termsAccepted,
          website: form.get("website"),
        }),
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Submission failed");
      }
      setState("success");
      setMessage("You're on the waitlist. We'll email launch news.");
      track("waitlist_success");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Please try again.");
    }
  }

  if (state === "success") {
    return (
      <div className="confirmation waitlist-confirmation" role="status" aria-live="polite">
        <h3>You&apos;re on the list.</h3>
        <p>We&apos;ll email when access opens. Teams are still invite-only.</p>
        <p className="confirmation-next">
          Plans: {raisedPricingSummaryLine()} on <a href="/pricing">pricing</a>.
        </p>
      </div>
    );
  }

  return (
    <form
      className={`waitlist-form soft-waitlist-form ${compact ? "compact-form" : ""}`}
      onSubmit={submit}
      aria-label="Join the Vantage waitlist"
    >
      <div className="field">
        <label htmlFor={`${prefix}-email`}>Email</label>
        <input
          id={`${prefix}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={state === "sending"}
        />
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-teamNumber`}>FRC team number</label>
        <input
          id={`${prefix}-teamNumber`}
          name="teamNumber"
          type="number"
          min={1}
          max={99999}
          inputMode="numeric"
          required
          disabled={state === "sending"}
        />
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-phone`}>
          Phone <span>optional</span>
        </label>
        <input
          id={`${prefix}-phone`}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+12025550123"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={state === "sending"}
        />
      </div>

      <div className="honeypot" aria-hidden="true">
        <label htmlFor={`${prefix}-website`}>Website</label>
        <input id={`${prefix}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {phoneProvided ? (
        <label className="consent">
          <input name="smsConsent" type="checkbox" required disabled={state === "sending"} />
          <span>I agree to receive occasional launch texts at this number.</span>
        </label>
      ) : null}

      <LegalAgreementCheckbox
        id={`${prefix}-terms`}
        checked={termsAccepted}
        onChange={(checked) => {
          setTermsAccepted(checked);
          if (checked && state === "error") {
            setState("idle");
            setMessage("");
          }
        }}
        required
      />

      {state === "error" ? (
        <p className="form-error form-status form-status-error" role="alert">
          {message}
        </p>
      ) : null}

      <button className="button primary" type="submit" disabled={state === "sending" || !termsAccepted}>
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
