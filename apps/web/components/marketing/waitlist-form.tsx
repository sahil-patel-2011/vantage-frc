"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { LegalAgreementCheckbox } from "../legal-agreement-checkbox";
import { legalConsentComplete, legalConsentMessage } from "../../lib/legal";
import { track } from "../../lib/marketing/analytics";
import { waitlistUnavailableCopy } from "../../lib/marketing/waitlist-copy";
import { rememberWaitlistJoined } from "../../lib/marketing/waitlist-joined";

type FormState = "idle" | "sending" | "success" | "error" | "unavailable";

type FieldErrors = { email?: string; teamNumber?: string; phone?: string };

/**
 * "+1 202 555 0123", or a plain ten-digit US number, which gets the +1 added. Null for
 * something that isn't a phone number, so the field can say so as soon as you leave it.
 */
export function normalizeWaitlistPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/^\+?[0-9 ()\-.]{7,22}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const PHONE_ERROR = "That doesn't look like a phone number. Try +1 202 555 0123.";

type WaitlistResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
};

function isUnavailablePayload(payload: WaitlistResponse | null, httpStatus: number): boolean {
  if (httpStatus === 503) return true;
  return payload?.status === "setup_required";
}

export type WaitlistStage = "setup" | "member" | "joined";

export function WaitlistForm({
  idPrefix = "waitlist",
  compact = false,
  onStageChange,
}: {
  idPrefix?: string;
  compact?: boolean;
  /** Lets the section around the form retitle itself to match what the form is showing. */
  onStageChange?: (stage: WaitlistStage) => void;
}) {
  const reactId = useId();
  const prefix = idPrefix || reactId.replace(/:/g, "");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [phone, setPhone] = useState("");
  // Said under the field that needs it, not as the browser's own bubble or a line above the button.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Two different people land here: a mentor who wants their team set up, and someone whose
  // team already uses Vantage (who needs an invite from their team, not a months-long list).
  const [intent, setIntent] = useState<"setup" | "member">("setup");
  const [prefillEmail, setPrefillEmail] = useState("");
  const successRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    onStageChange?.(state === "success" ? "joined" : intent);
  }, [state, intent, onStageChange]);

  // On a phone the form collapses into a short card and the page stays where it was, leaving
  // the confirmation under the sticky header. Bring it into view and move focus to it.
  useEffect(() => {
    if (state !== "success") return;
    const heading = successRef.current;
    if (!heading) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    heading.focus({ preventScroll: true });
  }, [state]);

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

  // What was sent, repeated back on success so a typo in the address is visible.
  const [recorded, setRecorded] = useState<{ email: string; team: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const fields = new FormData(formElement);
    const nextErrors: FieldErrors = {};
    const emailValue = String(fields.get("email") ?? "").trim();
    if (!emailValue) nextErrors.email = "Enter the email you want us to write to.";
    else if (!emailValue.includes("@")) nextErrors.email = "That email is missing the @ and the part after it.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailValue)) {
      nextErrors.email = "That email is missing the part after the dot, like .com or .org.";
    }
    const teamValue = String(fields.get("teamNumber") ?? "").trim();
    if (!teamValue) nextErrors.teamNumber = "Enter your FRC team number, like 6925.";
    else if (!/^[0-9]{1,5}$/.test(teamValue) || Number(teamValue) < 1) nextErrors.teamNumber = "Team numbers are digits only, 1 to 99999.";
    if (normalizeWaitlistPhone(phone) == null) nextErrors.phone = PHONE_ERROR;
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setState("idle");
      // The first field to fix gets focus and comes into view (on a phone the email error was
      // above the screen while the team-number one showed).
      window.requestAnimationFrame(() => {
        formElement.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
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
          phone: normalizeWaitlistPhone(phone) || form.get("phone"),
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
      const joined = { email: String(form.get("email") ?? "").trim(), team: String(form.get("teamNumber") ?? "").trim() };
      setRecorded(joined);
      rememberWaitlistJoined(joined);
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
        <h3 ref={successRef} tabIndex={-1}>
          You’re on the list.
        </h3>
        <p>
          {recorded?.email
            ? `We'll email ${recorded.email}${recorded.team ? ` when team ${recorded.team} is set up` : " when your team is set up"}, usually within a few days.`
            : "We'll email you when your team is set up, usually within a few days."}{" "}
          Then you sign in and invite your students and mentors. Joining the waitlist does not create a Vantage account.
          Signed up before? This only updated your details; there is nothing else to do.
        </p>
        {/* Said to everyone, so the form never reveals which teams already use Vantage. Second, and
            short: the outcome comes first, and a mentor whose team is already here still sees it. */}
        <p className="waitlist-aside waitlist-aside-box">
          <strong>{recorded?.team ? `Team ${recorded.team} already on Vantage?` : "Team already on Vantage?"}</strong>{" "}
          Skip the wait: ask its owner or a mentor to invite {recorded?.email ?? "your email"}, then{" "}
          <a href="/signin">sign in</a>.
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
            Ask your team&rsquo;s owner or a mentor to invite the email you want to use. The invite email has a link,
            and that link is all you need. No waitlist.
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
      // An error clears as soon as its field is edited: "Enter your FRC team number" stayed red
      // beside a valid 9876 until the next submit.
      onInput={(event) => {
        const name = (event.target as HTMLInputElement).name as keyof FieldErrors;
        if ((name === "email" || name === "teamNumber") && fieldErrors[name]) {
          setFieldErrors((current) => ({ ...current, [name]: undefined }));
        }
      }}
      aria-label="Join the Vantage waitlist"
      data-testid="waitlist-form"
      noValidate
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
          placeholder="you@school.org"
          required
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? `${prefix}-email-error` : undefined}
          disabled={state === "sending"}
        />
        {fieldErrors.email ? (
          <small id={`${prefix}-email-error`} className="field-error" role="alert">
            {fieldErrors.email}
          </small>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-teamNumber`}>FRC team number</label>
        <input
          id={`${prefix}-teamNumber`}
          name="teamNumber"
          type="text"
          inputMode="numeric"
          pattern="0*[1-9][0-9]{0,4}"
          maxLength={5}
          title="Your FRC team number, 1 to 99999"
          placeholder="e.g. 6925"
          aria-describedby={fieldErrors.teamNumber ? `${prefix}-teamNumber-error` : `${prefix}-teamNumber-hint`}
          aria-invalid={fieldErrors.teamNumber ? true : undefined}
          required
          disabled={state === "sending"}
        />
        {fieldErrors.teamNumber ? (
          <small id={`${prefix}-teamNumber-error`} className="field-error" role="alert">
            {fieldErrors.teamNumber}
          </small>
        ) : null}
        <small id={`${prefix}-teamNumber-hint`} className="field-hint">
          New team still waiting on a number? Email <a href="mailto:vantagefrc@gmail.com">vantagefrc@gmail.com</a> and
          we&rsquo;ll add you.
        </small>
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-phone`}>
          Phone <span>(optional)</span>
        </label>
        <input
          id={`${prefix}-phone`}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+1 202 555 0123"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            if (fieldErrors.phone) setFieldErrors((current) => ({ ...current, phone: undefined }));
          }}
          onBlur={() =>
            setFieldErrors((current) => ({ ...current, phone: normalizeWaitlistPhone(phone) == null ? PHONE_ERROR : undefined }))
          }
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={`${prefix}-phone-hint`}
          disabled={state === "sending"}
        />
        <small id={`${prefix}-phone-hint`} className={fieldErrors.phone ? "field-error" : "field-hint"} role={fieldErrors.phone ? "alert" : undefined}>
          {fieldErrors.phone ?? "Only for launch texts. A US number without +1 is fine."}
        </small>
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
