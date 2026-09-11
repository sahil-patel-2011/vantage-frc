"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { LegalAgreementCheckbox } from "../legal-agreement-checkbox";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";
import { track } from "../../lib/marketing/analytics";
import { waitlistUnavailableCopy } from "../../lib/marketing/waitlist-copy";

type FormState = "idle" | "sending" | "success" | "error" | "unavailable";

type WaitlistResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
};

function isUnavailablePayload(payload: WaitlistResponse | null, httpStatus: number): boolean {
  if (httpStatus === 503) return true;
  return payload?.status === "setup_required";
}

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
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [phone, setPhone] = useState("");

  const phoneProvided = phone.trim().length > 0;
  const consent = { terms: termsAccepted, privacy: privacyAccepted };
  // A missing-consent error belongs next to the boxes; anything else (network,
  // server rejection) belongs in the form-level status line.
  const consentError = state === "error" && !legalConsentComplete(consent) ? message : null;
  const unavailable = waitlistUnavailableCopy();

  useEffect(() => {
    let active = true;
    void fetch("/api/waitlist", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as WaitlistResponse | null;
        if (!active) return;
        if (isUnavailablePayload(payload, response.status)) setState("unavailable");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Terms and Privacy are two separate agreements; neither one stands in for
    // the other, so the form will not submit until both are ticked.
    if (!legalConsentComplete(consent)) {
      setState("error");
      setMessage(legalConsentMessage(consent) ?? "Agree to both documents to join.");
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
          privacyAccepted,
          website: form.get("website"),
        }),
      });
      const result = (await response.json().catch(() => null)) as WaitlistResponse | null;
      if (isUnavailablePayload(result, response.status)) {
        setState("unavailable");
        return;
      }
      if (!response.ok || !result?.ok) {
        throw new Error(result?.message ?? "Submission failed");
      }
      setState("success");
      setMessage("You're on the waitlist. We'll email launch news.");
      track("waitlist_success");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Please try again.");
    }
  }

  if (state === "unavailable") {
    return (
      <div className="confirmation waitlist-confirmation waitlist-unavailable" role="status">
        <h3>{unavailable.title}</h3>
        <p>{unavailable.body}</p>
        <p>
          <a href="mailto:sahiljpatel2011@gmail.com">Email Sahil</a>
        </p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="confirmation waitlist-confirmation" role="status" aria-live="polite">
        <h3>You’re on the list.</h3>
        <p>We&apos;ll email when access opens. Joining the waitlist does not create a Vantage account.</p>
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
          placeholder="Optional — for launch texts"
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
        id={`${prefix}-legal`}
        terms={termsAccepted}
        privacy={privacyAccepted}
        onChange={(next) => {
          setTermsAccepted(next.terms);
          setPrivacyAccepted(next.privacy);
          if (state === "error" && legalConsentComplete(next)) {
            setState("idle");
            setMessage("");
          }
        }}
        required
        disabled={state === "sending"}
        error={consentError}
      />

      {state === "error" && !consentError ? (
        <p className="form-error form-status form-status-error" role="alert">
          {message}
        </p>
      ) : null}

      <button className="button primary" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
