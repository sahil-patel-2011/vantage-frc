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

      {inviteHelp ? (
        <div className="signin-invite-help">
          <p>
            <strong>No code after a minute?</strong> Codes only go to emails a team has invited. Ask your team&rsquo;s
            owner to invite this address, or get your team set up.
          </p>
          <a className="signin-link" href={inviteHelp.waitlistHref}>
            Join the waitlist
          </a>
        </div>
      ) : null}
    </form>
  );
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
      <h2>You&rsquo;re not on a team yet</h2>
      <p>
        Vantage is invite-only. Ask your team&rsquo;s owner or a mentor to invite <strong>{email}</strong>, or join the
        waitlist to get your team set up.
      </p>
      <a className="signin-submit" href={waitlistHref}>
        Join the waitlist
      </a>
      <button type="button" className="signin-link" onClick={onUseAnotherEmail}>
        Use a different email
      </button>
    </div>
  );
}
