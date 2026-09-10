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
}: {
  channel: SignInChannel;
  email: string;
  emailHint: string | null;
  code: string;
  codeRef: RefObject<HTMLInputElement | null>;
  emailAvailable: boolean;
  invalid: boolean;
  expired: boolean;
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

      <p className={expired ? "signin-expiry expired" : "signin-expiry"}>
        {codeExpiryCopy(expired, codeSeconds)}
      </p>

      <button className="signin-submit" disabled={!submitReady || working}>
        {verifySubmitLabel(busy)}
      </button>

      <div className="signin-footer-modes">
        <button
          type="button"
          className="signin-link"
          disabled={!resendReady || working || !emailAvailable}
          onClick={onResend}
        >
          {resendLabel({ ready: resendReady, busy, seconds: resendSeconds })}
        </button>
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
    </form>
  );
}
