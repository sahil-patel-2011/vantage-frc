"use client";

import { type FormEvent, useRef, useState } from "react";
import { isCodeComplete, isLikelyEmail, normalizeSignInEmail } from "../../lib/sign-in";
import { CodeInput, MailIcon } from "./sign-in-chrome";

/**
 * "Can't get into your email?" — sign in with the recovery email a person added under
 * Account (POST /api/recovery). A code goes to that address; typing it back signs in.
 * The answer to "send" is the same whether or not the address is anyone's recovery email.
 */
export function SignInRecovery({
  nextPath,
  open,
  onOpenChange,
}: {
  nextPath: string;
  /** Open, it is the whole step: the main email form steps aside instead of sitting above it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  async function call(body: Record<string, string>) {
    const response = await fetch("/api/recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: response.ok && data.ok === true, error: data.error };
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setWorking(true);
    setMessage(null);
    try {
      const result = await call({ action: "send", email: normalizeSignInEmail(email) });
      if (result.ok) {
        setSent(true);
        setCode("");
        setMessage({ ok: true, text: "If that's a recovery email on a Vantage account, a 6-digit code is on its way." });
        window.setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        setMessage({ ok: false, text: result.error ?? "We couldn't send a code. Try again." });
      }
    } catch {
      setMessage({ ok: false, text: "We couldn't reach Vantage. Check your connection." });
    }
    setWorking(false);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage(null);
    try {
      const result = await call({ action: "verify", email: normalizeSignInEmail(email), code });
      if (result.ok) {
        window.location.assign(nextPath);
        return;
      }
      setMessage({ ok: false, text: result.error ?? "That code didn't work. Try again." });
    } catch {
      setMessage({ ok: false, text: "We couldn't reach Vantage. Check your connection." });
    }
    setWorking(false);
  }

  if (!open) {
    return (
      <div className="signin-footer-modes">
        <button type="button" className="signin-link" onClick={() => setOpen(true)}>
          Can&apos;t get into your email? Use your recovery email
        </button>
      </div>
    );
  }

  return (
    <div className="signin-recovery">
      <h2 className="signin-recovery-title">Use your recovery email</h2>
      <p className="signin-recovery-sub">
        We&rsquo;ll send a code to the recovery email you added to your account.
      </p>
      {!sent ? (
        <form className="signin-form" onSubmit={(event) => void send(event)}>
          <label>
            Recovery email
            <span className="signin-field">
              <MailIcon />
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                disabled={working}
                onChange={(event) => setEmail(event.target.value)}
              />
            </span>
          </label>
          <button className="signin-submit" disabled={working || !isLikelyEmail(email)}>
            {working ? "Sending…" : "Send a code"}
          </button>
        </form>
      ) : (
        <form className="signin-form" onSubmit={(event) => void verify(event)}>
          <label>
            Code sent to {normalizeSignInEmail(email)}
            <CodeInput value={code} disabled={working} invalid={false} inputRef={codeRef} onChange={setCode} />
          </label>
          <button className="signin-submit" disabled={working || !isCodeComplete(code)}>
            {working ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="signin-link" disabled={working} onClick={() => void send()}>
            Send a new code
          </button>
        </form>
      )}
      {message ? (
        <p className="signin-status" role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      <button
        type="button"
        className="signin-link"
        onClick={() => {
          setOpen(false);
          setSent(false);
          setMessage(null);
        }}
      >
        Back to sign in
      </button>
    </div>
  );
}
