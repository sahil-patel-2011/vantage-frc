"use client";

import type { FormEvent } from "react";
import { Panel, Button } from "../../components/ui";
import { formatAccountOrgLabel } from "../../lib/account";
import type { AccountView, OrgContext } from "./account-types";

export function AccountProfilePanel({
  account,
  org,
  displayName,
  firstName,
  lastName,
  dateOfBirth,
  recoveryEmail,
  phoneE164,
  otpCode,
  busy,
  onDisplayNameChange,
  onFirstNameChange,
  onLastNameChange,
  onDateOfBirthChange,
  onRecoveryEmailChange,
  onPhoneE164Change,
  onOtpCodeChange,
  onSave,
  onSendPhoneOtp,
  onVerifyPhoneOtp,
  onSignOut,
}: {
  account: AccountView;
  org: OrgContext;
  displayName: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  recoveryEmail: string;
  phoneE164: string;
  otpCode: string;
  busy: boolean;
  onDisplayNameChange: (value: string) => void;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onDateOfBirthChange: (value: string) => void;
  onRecoveryEmailChange: (value: string) => void;
  onPhoneE164Change: (value: string) => void;
  onOtpCodeChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onSendPhoneOtp: () => void;
  onVerifyPhoneOtp: () => void;
  onSignOut: () => void;
}) {
  const initial = (displayName.trim()?.[0] ?? account.email?.trim()?.[0] ?? "?").toUpperCase();
  const orgId = org.orgId;

  return (
    <Panel className="account-panel">
      <div className="account-identity">
        {account.image ? (
          <img className="soft-avatar lg" src={account.image} alt="" />
        ) : (
          <span className="soft-avatar lg">{initial}</span>
        )}
        <div>
          <strong>{displayName || "Signed-in user"}</strong>
          <span>{account.email ?? "—"}</span>
          <span className="account-identity-scope">
            {orgId
              ? `Personal account · team ${formatAccountOrgLabel(org) ?? "active"}`
              : "Personal account · no team selected"}
          </span>
        </div>
      </div>
      <form className="account-form" onSubmit={(event) => void onSave(event)}>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            maxLength={80}
            autoComplete="nickname"
            required
          />
        </label>
        <label>
          First name
          <input
            value={firstName}
            onChange={(event) => onFirstNameChange(event.target.value)}
            maxLength={60}
            autoComplete="given-name"
          />
        </label>
        <label>
          Last name
          <input
            value={lastName}
            onChange={(event) => onLastNameChange(event.target.value)}
            maxLength={60}
            autoComplete="family-name"
          />
        </label>
        <label>
          Date of birth
          <input
            type="date"
            value={dateOfBirth}
            onChange={(event) => onDateOfBirthChange(event.target.value)}
            autoComplete="bday"
          />
        </label>
        <label>
          Sign-in email
          <input value={account.email ?? ""} readOnly disabled />
        </label>
        <label>
          Recovery email
          <input
            type="email"
            value={recoveryEmail}
            onChange={(event) => onRecoveryEmailChange(event.target.value)}
            autoComplete="email"
            placeholder="A second inbox for account recovery"
          />
        </label>
        <label>
          Phone number for text codes
          <input
            type="tel"
            value={phoneE164}
            onChange={(event) => onPhoneE164Change(event.target.value)}
            autoComplete="tel"
            placeholder="+15551234567"
          />
        </label>
        <p className="app-muted">
          {account.phoneVerified
            ? "This phone number is confirmed."
            : account.phoneOtp?.configured
              ? "Save the number, then send a code to confirm it."
              : "Text messaging isn't set up for phone codes yet. Email sign-in still works."}
        </p>
        <div className="account-actions">
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void onSendPhoneOtp()}>
            Send phone code
          </Button>
          <input
            value={otpCode}
            onChange={(event) => onOtpCodeChange(event.target.value)}
            maxLength={6}
            inputMode="numeric"
            placeholder="6-digit code"
            aria-label="Phone confirmation code"
          />
          <Button variant="secondary" type="button" disabled={busy || otpCode.length !== 6} onClick={() => void onVerifyPhoneOtp()}>
            Verify phone
          </Button>
        </div>
        <div className="account-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            Save profile
          </Button>
          <Button variant="danger" type="button" disabled={busy} onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </form>
    </Panel>
  );
}
