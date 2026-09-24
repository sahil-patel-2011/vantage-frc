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
  // Two different people land here: a mentor who wants their team set up, and someone whose
  // team already uses Vantage (who needs an invite from their team, not a months-long list).
  const [intent, setIntent] = useState<"setup" | "member">("setup");
  const [prefillEmail, setPrefillEmail] = useState("");

  // Sign-in hands over the address it already has, in session storage rather than the URL.
  useEffect(() => {
    try {
      const email = sessionStorage.getItem("vantage.waitlist.email") ?? "";
      sessionStorage.removeItem("vantage.waitlist.email");
      if (/^[^@\s]+@[^@\s]+$/.test(email)) setPrefillEmail(email.slice(0, 200));
    } catch {
      // Storage blocked: the field starts empty.
    }
  }, []);

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
      setMessage("You're on the list. We'll email you when your team is set up.");
      track("waitlist_success");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Please try again.");
    }
  }

  if (state === "unavailable") {
    return (
      <div
        className="confirmation waitlist-confirmation waitlist-unavailable"
        role="status"
        data-testid="waitlist-unavailable"
      >
        <h3>{unavailable.title}</h3>
        <p>{unavailable.body}</p>
        <p>
          <a href="mailto:vantagefrc@gmail.com">Email us</a>
        </p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div
        className="confirmation waitlist-confirmation"
        role="status"
        aria-live="polite"
        data-testid="waitlist-success"
      >
        <h3>You’re on the list.</h3>
        <p>
          We set teams up one at a time and will email you when yours is ready. Then you sign in and invite your
          students and mentors by email. Joining the waitlist does not create a Vantage account.
        </p>
      </div>
    );
  }

  const choice = (
    <div className="waitlist-intent" role="radiogroup" aria-label="What do you need?">
      <button type="button" role="radio" aria-checked={intent === "setup"} onClick={() => setIntent("setup")}>
        Get my team set up
      </button>
      <button type="button" role="radio" aria-checked={intent === "member"} onClick={() => setIntent("member")}>
        My team already uses Vantage
      </button>
    </div>
  );

  if (intent === "member") {
    return (
      <div className={`waitlist-form soft-waitlist-form ${compact ? "compact-form" : ""}`} data-testid="waitlist-member">
        {choice}
        <div className="waitlist-member-note" role="status">
          <h3>Ask your team for an invite</h3>
          <p>
            Your team&rsquo;s owner or a mentor adds you from Team admin → Invite someone, using the email you sign in
            with. You&rsquo;ll get an email with a link, and that link is all you need. No waitlist.
          </p>
          <a className="button secondary" href="/signin">
            I have an invite: sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      className={`waitlist-form soft-waitlist-form ${compact ? "compact-form" : ""}`}
      onSubmit={submit}
      aria-label="Join the Vantage waitlist"
      data-testid="waitlist-form"
    >
      {choice}
      <div className="field">
        <label htmlFor={`${prefix}-email`}>Email</label>
        <input
          id={`${prefix}-email`}
          key={prefillEmail || "empty"}
          defaultValue={prefillEmail}
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
        <p className="form-error form-status form-status-error" role="alert" data-testid="waitlist-error">
          {message}
        </p>
      ) : null}

      <button className="button primary" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
