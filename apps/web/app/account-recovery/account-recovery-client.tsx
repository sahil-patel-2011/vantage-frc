"use client";

import { type FormEvent, useState } from "react";
import { SignInCard } from "../sign-in/sign-in-chrome";
import { SignInRecovery } from "../sign-in/sign-in-recovery";
// The same styles the sign-in page loads: it is outside the app frame, so nothing else does.
import "../product-styles";
import "../sign-in/sign-in-flow.css";
import "../vantage-scan-auth.css";
import "./account-recovery.css";

type Field = "firstName" | "lastName" | "email" | "dateOfBirth" | "lastPassword" | "recoveryEmail";
const EMPTY: Record<Field, string> = { firstName: "", lastName: "", email: "", dateOfBirth: "", lastPassword: "", recoveryEmail: "" };

/**
 * Locked out: ask a person on the Vantage team to check who you are. Six fields, one button,
 * and a plain answer. Nothing is reset or unlocked automatically.
 */
export function AccountRecoveryClient({ nextPath }: { nextPath: string }) {
  const [values, setValues] = useState(EMPTY);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field | null; text: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const set = (field: Field) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, website }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: Field };
      if (response.ok && data.ok) {
        setSent(true);
        setValues(EMPTY);
        return;
      }
      setError({ field: data.field ?? null, text: data.error ?? "We couldn't send your request. Try again in a few minutes." });
      if (data.field) document.getElementById(`recovery-${data.field}`)?.focus();
    } catch {
      setError({ field: null, text: "We couldn't reach Vantage. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <SignInCard titleId="recovery-title" title="Request received">
        <p className="signin-sub" role="status">
          We got your request. A person on the Vantage team will check it and reply by email, usually within a day or
          two. Nothing changes on your account until then.
        </p>
        <p className="signin-recovery-link">
          <a href={`/signin?next=${encodeURIComponent(nextPath)}`}>Back to sign in</a>
        </p>
      </SignInCard>
    );
  }

  const invalid = (field: Field) => (error?.field === field ? true : undefined);

  return (
    <SignInCard
      titleId="recovery-title"
      title="Recover your account"
      subtitle="Tell us who you are. A person on the Vantage team reviews every request and replies by email."
    >
      <form className="signin-form recovery-form" onSubmit={submit} noValidate>
        <div className="recovery-row">
          <label>
            First name
            <span className="signin-field">
              <input id="recovery-firstName" autoComplete="given-name" value={values.firstName} onChange={set("firstName")} aria-invalid={invalid("firstName")} required />
            </span>
          </label>
          <label>
            Last name
            <span className="signin-field">
              <input id="recovery-lastName" autoComplete="family-name" value={values.lastName} onChange={set("lastName")} aria-invalid={invalid("lastName")} required />
            </span>
          </label>
        </div>
        <label>
          Email on the account
          <span className="signin-field">
            <input id="recovery-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={values.email} onChange={set("email")} aria-invalid={invalid("email")} required />
          </span>
        </label>
        <label>
          Date of birth
          <span className="signin-field">
            <input id="recovery-dateOfBirth" type="date" autoComplete="bday" value={values.dateOfBirth} onChange={set("dateOfBirth")} aria-invalid={invalid("dateOfBirth")} required />
          </span>
        </label>
        <label>
          Last password you remember <span className="recovery-optional">(optional)</span>
          <span className="signin-field">
            <input id="recovery-lastPassword" type="password" autoComplete="off" value={values.lastPassword} onChange={set("lastPassword")} />
          </span>
          <small className="signin-email-hint">Only the Vantage team sees it, to help check it&apos;s you.</small>
        </label>
        <label>
          Recovery email <span className="recovery-optional">(if you added one)</span>
          <span className="signin-field">
            <input id="recovery-recoveryEmail" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={values.recoveryEmail} onChange={set("recoveryEmail")} aria-invalid={invalid("recoveryEmail")} />
          </span>
        </label>
        {/* Hidden from people; a bot that fills it is answered and ignored. */}
        <input className="recovery-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} name="website" />
        {error ? <p className="signin-status error" role="alert">{error.text}</p> : null}
        <button className="signin-submit" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>

      <div className="signin-footer">
        {/* Someone who set up a recovery email can sign in with it right now instead of waiting. */}
        <SignInRecovery nextPath={nextPath} open={recoveryOpen} onOpenChange={setRecoveryOpen} />
        <p className="signin-recovery-link">
          <a href={`/signin?next=${encodeURIComponent(nextPath)}`}>Back to sign in</a>
        </p>
      </div>
    </SignInCard>
  );
}
