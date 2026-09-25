"use client";

import { useEffect, useState, type FormEvent, type RefObject } from "react";
import { waitlistJoinedFor, type WaitlistJoined } from "../../lib/marketing/waitlist-joined";
import type { SignInChannel } from "../../lib/sign-in";
import { codeExpiryCopy, resendLabel, verifySubmitLabel, type SignInBusy } from "./sign-in-model";
import { CodeInput } from "./sign-in-chrome";

export function SignInCodeStep({
  channel,
  email,
  emailHint,
  code,
  codeRef,
  emailAvailable,
  invalid,
  failureMessage,
  expired,
  showClock,
  showResend,
  codeSeconds,
  resendReady,
  resendSeconds,
  submitReady,
  busy,
  working,
  resolvedNext,
  onSubmit,
  onCodeChange,
  onEditEmail,
  onResend,
  onSwitchAccount,
  inviteHelp,
}: {
  channel: SignInChannel;
  email: string;
  emailHint: string | null;
  code: string;
  codeRef: RefObject<HTMLInputElement | null>;
  emailAvailable: boolean;
  invalid: boolean;
  /** Why the last code failed, shown right under the boxes. */
  failureMessage?: string | null;
  expired: boolean;
  showClock: boolean;
  showResend: boolean;
  codeSeconds: number;
  resendReady: boolean;
  resendSeconds: number;
  submitReady: boolean;
  busy: SignInBusy;
  working: boolean;
  resolvedNext: string;
  onSubmit: (event: FormEvent) => void;
  onCodeChange: (code: string) => void;
  onEditEmail: () => void;
  onResend: () => void;
  onSwitchAccount: (href: string) => void;
  /** Shown under the code for a first sign-in without an invite link: where a code comes from. */
  inviteHelp?: { waitlistHref: string } | null;
}) {
  return (
    <form className="signin-form" onSubmit={onSubmit}>
      <div className="signin-code-target">
        <strong>{channel === "email-2fa" ? emailHint : email}</strong>
        {channel === "email-otp" ? (
          <button type="button" className="signin-link" disabled={working} onClick={onEditEmail}>
            Edit
          </button>
        ) : null}
      </div>

      <CodeInput
        value={code}
        disabled={working || !emailAvailable}
        invalid={invalid}
        inputRef={codeRef}
        onChange={onCodeChange}
      />
      {failureMessage ? (
        <p className="signin-code-error" role="alert">
          {failureMessage}
        </p>
      ) : null}

      {showClock ? (
        <p className={expired ? "signin-expiry expired" : "signin-expiry"}>
          {codeExpiryCopy(expired, codeSeconds)}
        </p>
      ) : null}

      {/* The code sends itself once six digits are in, so a grey "Verify" waiting beside the
          boxes looked broken. It shows when there is a full code it hasn't tried. */}
      {submitReady || busy !== "idle" ? (
        <button className="signin-submit" disabled={!submitReady || working}>
          {verifySubmitLabel(busy)}
        </button>
      ) : null}

      {showResend || channel === "email-2fa" ? (
        <div className="signin-footer-modes">
          {showResend ? (
            <button
              type="button"
              className="signin-link"
              disabled={!resendReady || working || !emailAvailable}
              onClick={onResend}
            >
              {resendLabel({ ready: resendReady, busy, seconds: resendSeconds })}
            </button>
          ) : null}
          {channel === "email-2fa" ? (
            <button
              type="button"
              className="signin-link"
              disabled={working}
              onClick={() => onSwitchAccount(`/signin?next=${encodeURIComponent(resolvedNext)}`)}
            >
              Use another account
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Always open, and still there after a wrong code: an address no team invited never gets
          a code, and a folded note left a new mentor waiting on a timer for one. */}
      {inviteHelp ? (
        <div className="signin-invite-help">
          <p>
            <strong>Not invited yet? No code will come.</strong> Codes only go to emails a team has invited. If
            you were invited and nothing arrives in a minute, check spam.
          </p>
          <a
            className="signin-invite-help-cta"
            href={inviteHelp.waitlistHref}
            onClick={() => rememberWaitlistEmail(email)}
          >
            New team? Join the waitlist
          </a>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Hand the typed address to the waitlist form without putting it in the URL, where history,
 * logs and analytics would keep it. Read once by components/marketing/waitlist-form.tsx.
 */
export const WAITLIST_EMAIL_KEY = "vantage.waitlist.email";
function rememberWaitlistEmail(email: string) {
  try {
    sessionStorage.setItem(WAITLIST_EMAIL_KEY, email.trim().slice(0, 200));
  } catch {
    // Private mode: the form is simply empty.
  }
}

/**
 * The right code, but this email is on no team. Not an error: Vantage is invite-only, and this
 * is where a newcomer finds out. One clear next step, and a way back.
 */
export function SignInNotInvited({
  email,
  waitlistHref,
  onUseAnotherEmail,
}: {
  email: string;
  waitlistHref: string;
  onUseAnotherEmail: () => void;
}) {
  // Joined from this browser already: say so, instead of asking them to join again.
  const [joined, setJoined] = useState<WaitlistJoined | null>(null);
  useEffect(() => setJoined(waitlistJoinedFor(email)), [email]);
  if (joined) {
    return (
      <div className="signin-not-invited" role="status">
        <p>
          You&rsquo;re on the waitlist{joined.team ? ` for team ${joined.team}` : ""}. We&rsquo;ll email{" "}
          <strong>{email}</strong> when your team is set up; there&rsquo;s nothing else to do until then.
        </p>
        <p className="app-muted">Already on a team that uses Vantage? Ask its owner or a mentor to invite this address.</p>
        <a className="signin-submit" href="/">
          Back to the home page
        </a>
        <button type="button" className="signin-link" onClick={onUseAnotherEmail}>
          Use a different email
        </button>
      </div>
    );
  }
  return (
    <div className="signin-not-invited" role="status">
      <p>
        Vantage is invite-only. Ask your team&rsquo;s owner or a mentor to invite <strong>{email}</strong>, or join the
        waitlist to get your team set up.
      </p>
      <a className="signin-submit" href={waitlistHref} onClick={() => rememberWaitlistEmail(email)}>
        Join the waitlist
      </a>
      <button type="button" className="signin-link" onClick={onUseAnotherEmail}>
        Use a different email
      </button>
    </div>
  );
}
