"use client";

import { type FormEvent, useId, useState } from "react";
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted) {
      setState("error");
      setMessage("Agree to the Terms of Service and Privacy Policy to join the waitlist.");
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
          smsConsent: form.get("smsConsent") === "on",
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
        <span className="signal">YOU&apos;RE IN</span>
        <h3>You&apos;re on the list.</h3>
        <p>
          We&apos;ll email launch news. Joining does not create a Vantage account or team
          organization—admins still provision access separately.
        </p>
        <p className="confirmation-next">
          Meanwhile, review raised plans: Access $55 · Individual $79/$119 · Team $229/$449 on{" "}
          <a href="/pricing">pricing</a>.
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
          disabled={state === "sending"}
        />
      </div>

      <div className="honeypot" aria-hidden="true">
        <label htmlFor={`${prefix}-website`}>Website</label>
        <input
          id={`${prefix}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <label className="consent">
        <input name="smsConsent" type="checkbox" disabled={state === "sending"} />
        <span>
          I agree to receive occasional Vantage launch texts at the number provided. Consent is
          not a condition of access.
        </span>
      </label>

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

      <p className="form-note">
        Email is used for waitlist and launch updates only. Read our{" "}
        <a href="/privacy">Privacy Policy</a>. Terms acceptance is required before you can join.
      </p>

      {state === "error" ? (
        <p className="form-error form-status form-status-error" role="alert">
          {message}
        </p>
      ) : null}

      {!termsAccepted && state !== "error" ? (
        <p className="form-hint" id={`${prefix}-terms-hint`}>
          Check Terms &amp; Privacy to enable join.
        </p>
      ) : null}

      <button
        className="button primary"
        type="submit"
        disabled={state === "sending" || !termsAccepted}
        aria-describedby={!termsAccepted ? `${prefix}-terms-hint` : undefined}
      >
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
