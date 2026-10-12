"use client";

import type { FormEvent, RefObject } from "react";
import { emailEntryHint, formatCooldown, isLikelyEmail } from "../../lib/sign-in";
import {
  emailSubmitLabel,
  googleButtonLabel,
  passwordSubmitLabel,
  type PasswordPanel,
  type SignInBusy,
} from "./sign-in-model";
import { CodeInput, GoogleMark, LockIcon, MailIcon } from "./sign-in-chrome";

export function SignInIdentityStep({
  googleAvailable,
  emailAvailable,
  preferred,
  rememberedEmail,
  email,
  emailRef,
  busy,
  working,
  emailCooldown = 0,
  passwordPanel,
  resetSent,
  password,
  passwordMessage,
  code,
  codeRef,
  onGoogle,
  onSubmitIdentity,
  onEmailChange,
  onEmailBlur,
  onForgetAccount,
  onPasswordSubmit,
  onPasswordChange,
  onCodeChange,
  invited = false,
}: {
  googleAvailable: boolean;
  emailAvailable: boolean;
  preferred: "google" | "email";
  rememberedEmail: string | null;
  email: string;
  emailRef: RefObject<HTMLInputElement | null>;
  busy: SignInBusy;
  working: boolean;
  emailCooldown?: number;
  passwordPanel: PasswordPanel;
  resetSent: boolean;
  password: string;
  passwordMessage: string;
  code: string;
  codeRef: RefObject<HTMLInputElement | null>;
  onGoogle: () => void;
  onSubmitIdentity: (event: FormEvent) => void;
  onEmailChange: (email: string) => void;
  onEmailBlur: (email: string) => void;
  onForgetAccount: () => void;
  onPasswordSubmit: (event: FormEvent) => void;
  onPasswordChange: (password: string) => void;
  onCodeChange: (code: string) => void;
  /** Signing in to accept an invitation: no "join with a team code" detour. */
  invited?: boolean;
}) {
  const entryHint = email.trim().length > 3 ? emailEntryHint(email) : null;
  return (
    <>
      {googleAvailable ? (
        <>
          <button className="signin-google" type="button" onClick={onGoogle} disabled={working}>
            <GoogleMark />
            {googleButtonLabel(busy)}
            {preferred === "google" ? <em className="signin-last-used">Last used</em> : null}
          </button>
          <div className="signin-or" role="separator">
            <span>{passwordPanel === "password" ? "or use your password" : passwordPanel === "reset" ? "or reset your password" : "or use an email code"}</span>
          </div>
        </>
      ) : null}

      {passwordPanel === "closed" ? (
        // noValidate: the button and the line under the field do the checking, in words. The
        // browser's own check refused some addresses with no message at all on iPhone.
        <form className="signin-form" onSubmit={onSubmitIdentity} noValidate>
          <label>
            Email
            <span className="signin-field">
              <MailIcon />
              <input
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                disabled={working}
                autoFocus={preferred === "email" && !rememberedEmail}
                onChange={(event) => onEmailChange(event.target.value)}
                onBlur={(event) => onEmailBlur(event.target.value)}
              />
            </span>
            {rememberedEmail && email.trim().toLowerCase() === rememberedEmail.trim().toLowerCase() ? (
              <small className="signin-remembered">
                Remembered on this device.{" "}
                <button type="button" className="signin-link" onClick={onForgetAccount}>
                  Forget
                </button>
              </small>
            ) : null}
            {/* The button just stayed grey for "mentor@example": say what is missing. */}
            {entryHint ? (
              <small className="signin-email-hint" aria-live="polite">
                {entryHint}
              </small>
            ) : null}
          </label>
          <button className="signin-submit" disabled={!emailAvailable || working || !isLikelyEmail(email) || emailCooldown > 0}>
            {emailCooldown > 0 ? `Try again in ${formatCooldown(emailCooldown)}` : emailSubmitLabel(busy)}
          </button>
          {/* Sending can take several seconds; a small grey "Sending…" looked stuck. */}
          {busy === "sending" ? (
            <p className="signin-status signin-sending" role="status">
              Sending a code to {email.trim()}. This can take a few seconds.
            </p>
          ) : null}
        </form>
      ) : (
        <form className="signin-form" onSubmit={onPasswordSubmit}>
          <label>
            Email
            <span className="signin-field">
              <MailIcon />
              <input
                type="email"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                disabled={working}
                onChange={(event) => onEmailChange(event.target.value)}
              />
            </span>
          </label>
          {passwordPanel === "reset" && resetSent ? (
            <label>
              Reset code
              <CodeInput
                value={code}
                disabled={working}
                invalid={false}
                inputRef={codeRef}
                onChange={onCodeChange}
              />
            </label>
          ) : null}
          {passwordPanel === "password" || resetSent ? (
            <label>
              {passwordPanel === "reset" ? "New password" : "Password"}
              <span className="signin-field">
                <LockIcon />
                <input
                  type="password"
                  required
                  minLength={passwordPanel === "reset" ? 12 : undefined}
                  autoComplete={passwordPanel === "reset" ? "new-password" : "current-password"}
                  value={password}
                  disabled={working}
                  onChange={(event) => onPasswordChange(event.target.value)}
                />
              </span>
            </label>
          ) : null}
          <button className="signin-submit" disabled={working || !isLikelyEmail(email) || (passwordPanel === "reset" && resetSent && (!/^\d{6}$/.test(code) || password.length < 12))}>
            {passwordSubmitLabel(passwordPanel, { resetSent, working })}
          </button>
          {passwordPanel === "reset" && resetSent ? <p className="signin-email-hint">Enter the six-digit reset code and a password with at least 12 characters.</p> : null}
          {passwordMessage ? (
            <p className="signin-status" role="status">
              {passwordMessage}
            </p>
          ) : null}
        </form>
      )}
      {/* The other way in comes after the main one, as on Apple and Google sign-in pages. */}
      {invited ? null : (
        <p className="signin-email-hint">New to your team? <a className="signin-link" href="/join-team">Join with a team code</a></p>
      )}
    </>
  );
}

export function SignInPasswordFooter({
  working = false,
  passwordSignInAvailable,
  emailAvailable,
  identityStep,
  passwordPanel,
  onUsePassword,
  onBackToCodes,
  onForgotPassword,
}: {
  working?: boolean;
  passwordSignInAvailable: boolean;
  emailAvailable: boolean;
  identityStep: boolean;
  passwordPanel: PasswordPanel;
  onUsePassword: () => void;
  onBackToCodes: () => void;
  onForgotPassword: () => void;
}) {
  if (!identityStep || !passwordSignInAvailable) return null;
  return (
    <div className="signin-footer-modes">
      {passwordPanel === "closed" ? (
        <button type="button" className="signin-link" disabled={working} onClick={onUsePassword}>
          Use a password instead
        </button>
      ) : (
        <>
          {emailAvailable ? (
            <button type="button" className="signin-link" disabled={working} onClick={onBackToCodes}>
              Back to email codes
            </button>
          ) : null}
          {passwordPanel === "password" ? (
            <button type="button" className="signin-link" disabled={working} onClick={onForgotPassword}>
              Forgot password?
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
