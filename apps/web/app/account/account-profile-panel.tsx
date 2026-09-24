"use client";

import type { FormEvent } from "react";
import { Panel, Button } from "../../components/ui";
import { formatAccountOrgLabel } from "../../lib/account";
import type { AccountView, OrgContext } from "./account-types";
import { RecoveryEmailSettings } from "./recovery-email-settings";

export function AccountProfilePanel({
  account,
  org,
  displayName,
  firstName,
  lastName,
  dateOfBirth,
  teamRole,
  onTeamRoleChange,
  savedNote,
  recoveryEmail,
  phoneE164,
  otpCode,
  busy,
  onDisplayNameChange,
  onFirstNameChange,
  onLastNameChange,
  onDateOfBirthChange,
  onRecoveryEmailChange: _onRecoveryEmailChange,
  onPhoneE164Change,
  onOtpCodeChange,
  onSave,
  onSendPhoneOtp,
  onVerifyPhoneOtp,
  onSignOut: _onSignOut,
}: {
  account: AccountView;
  org: OrgContext;
  displayName: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  teamRole: string;
  onTeamRoleChange: (value: string) => void;
  /** Shown beside Save once the profile saved, so the button itself confirms it. */
  savedNote: string;
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
          Your role on the team
          <select value={teamRole} onChange={(event) => onTeamRoleChange(event.target.value)}>
            {teamRole ? null : <option value="">Choose one</option>}
            <option value="student">Student</option>
            <option value="mentor">Mentor</option>
            <option value="coach">Coach</option>
            <option value="parent">Parent</option>
            <option value="other">Something else (alum, volunteer, sponsor)</option>
          </select>
        </label>
        <p className="app-muted">
          Mentors, coaches and parents count as adults for the team&rsquo;s chat safety rules.
        </p>
        <label>
          Sign-in email
          <input value={account.email ?? ""} readOnly disabled />
        </label>
        <RecoveryEmailSettings suggested={recoveryEmail} />
        {/* Phone codes only when Vantage can actually send a text; otherwise the buttons
            did nothing but fail. */}
        {account.phoneOtp?.configured || account.phoneVerified ? (
          <>
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
          {account.phoneVerified ? "This phone number is confirmed." : "Save the number, then send a code to confirm it."}
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
          </>
        ) : null}
        <div className="account-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
          {savedNote ? (
            <span className="account-saved" role="status">
              {savedNote}
            </span>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
