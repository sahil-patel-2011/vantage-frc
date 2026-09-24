"use client";

import type { FormEvent, RefObject } from "react";
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

      {showClock ? (
        <p className={expired ? "signin-expiry expired" : "signin-expiry"}>
          {codeExpiryCopy(expired, codeSeconds)}
        </p>
      ) : null}

      <button className="signin-submit" disabled={!submitReady || working}>
        {verifySubmitLabel(busy)}
      </button>

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

      {inviteHelp && !invalid ? (
        // Folded: most people on this screen were invited and their code is on its way.
        <details className="signin-invite-help">
          <summary>No code?</summary>
          <p>
            We only send codes to emails a team has invited. If yours hasn&rsquo;t arrived after a minute, check spam,
            or ask your team&rsquo;s owner to invite this address.
          </p>
          <a
            className="signin-invite-help-cta"
            href={inviteHelp.waitlistHref}
            onClick={() => rememberWaitlistEmail(email)}
          >
            New team? Join the waitlist
          </a>
        </details>
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
