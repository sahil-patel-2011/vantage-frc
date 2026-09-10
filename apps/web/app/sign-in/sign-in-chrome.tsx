"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { VantageLogo } from "../../components/brand";
import {
  OTP_LENGTH,
  activeDigitIndex,
  codeDigits,
  codeFromPastedText,
  sanitizeCodeInput,
  type SignInSetupCopy,
} from "../../lib/sign-in";
import type { InvitePreview } from "../../lib/invite";
import { inviteBannerBody } from "./sign-in-model";

export function SignInCard({
  titleId,
  title,
  subtitle,
  children,
}: {
  titleId: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="signin-page">
      <section className="signin-card" aria-labelledby={titleId}>
        <div className="signin-brand">
          <VantageLogo />
        </div>
        <h1 id={titleId}>{title}</h1>
        {subtitle ? <p className="signin-sub">{subtitle}</p> : null}
        {children}
      </section>
    </main>
  );
}

export function SetupShell({ copy }: { copy: SignInSetupCopy }) {
  return (
    <div className="signin-setup-shell" role="status">
      <span>{copy.badge}</span>
      <strong>{copy.title}</strong>
      <p>{copy.description}</p>
    </div>
  );
}

export function AccessFooter() {
  return (
    <p className="signin-waitlist">
      Need access? <a href="/#waitlist">Join the waitlist</a>
      <span aria-hidden="true"> · </span>
      <a href="/pricing">Pricing</a>
    </p>
  );
}

export function InviteBanner({
  token,
  headline,
  preview,
}: {
  token: string | null;
  headline: string | null;
  preview: InvitePreview | null;
}) {
  if (!token) return null;
  return (
    <div className="signin-invite" role="note">
      <span>INVITATION</span>
      <strong>{headline}</strong>
      <p>{inviteBannerBody(preview?.email)}</p>
    </div>
  );
}

/**
 * Six boxes the eye can count, one real input underneath.
 *
 * The single input is what carries `autocomplete="one-time-code"`, so iOS and
 * Android offer the code from the mail/SMS notification, and a full-code paste
 * lands in one place instead of scattering across six separate fields.
 */
export function CodeInput({
  value,
  disabled,
  invalid,
  inputRef,
  onChange,
}: {
  value: string;
  disabled: boolean;
  invalid: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (next: string) => void;
}) {
  const digits = codeDigits(value);
  const active = activeDigitIndex(value);
  const [focused, setFocused] = useState(false);

  return (
    /* The input is absolutely positioned over the boxes, so a click anywhere in
       this block already lands on it — no extra click handler to keyboard-trap. */
    <div className={`signin-code${invalid ? " invalid" : ""}${disabled ? " disabled" : ""}`}>
      <input
        ref={inputRef}
        className="signin-code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={`${OTP_LENGTH}-digit sign-in code`}
        aria-invalid={invalid || undefined}
        maxLength={OTP_LENGTH}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(sanitizeCodeInput(event.target.value))}
        onPaste={(event) => {
          const pasted = codeFromPastedText(event.clipboardData.getData("text"));
          if (!pasted) return;
          event.preventDefault();
          onChange(pasted);
        }}
      />
      <div className="signin-code-boxes" aria-hidden="true">
        {digits.map((digit, index) => (
          <span
            key={index}
            className={
              focused && !disabled && index === active && digits[index] === ""
                ? "signin-code-box caret"
                : "signin-code-box"
            }
          >
            {digit}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SignInStatusBlock({
  failure,
  notice,
  oauthMessage,
  inviteHint,
}: {
  failure: string | null;
  notice: string | null;
  oauthMessage: string;
  inviteHint: string | null;
}) {
  return (
    <>
      {failure ? (
        <p className="signin-status error" role="alert">
          {failure}
        </p>
      ) : notice ? (
        <p className="signin-status" role="status">
          {notice}
        </p>
      ) : null}

      {oauthMessage ? (
        <p className="signin-status error" role="alert">
          {oauthMessage}
        </p>
      ) : null}

      {inviteHint ? (
        <div className="signin-setup-shell" role="status">
          <span>invite only</span>
          <strong>No code in your inbox?</strong>
          <p>{inviteHint}</p>
        </div>
      ) : null}
    </>
  );
}

export function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7 12.9 19.6C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.5 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.4 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l.1.1 6.2 5.2C39.3 37.2 44 32 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
