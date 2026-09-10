"use client";

import type { InvitePreview } from "../../lib/invite";
import { continueAsLabel } from "./sign-in-model";
import { AccessFooter, InviteBanner, SignInCard } from "./sign-in-chrome";

export function SignInSessionView({
  inviteHeadline,
  inviteToken,
  invitePreview,
  emailHint,
  working,
  resolvedNext,
  onContinue,
  onSwitchAccount,
}: {
  inviteHeadline: string | null;
  inviteToken: string | null;
  invitePreview: InvitePreview | null;
  emailHint: string;
  working: boolean;
  resolvedNext: string;
  onContinue: () => void;
  onSwitchAccount: (href: string) => void;
}) {
  return (
    <SignInCard
      titleId="signin-title"
      title={inviteHeadline ?? "You’re already signed in"}
      subtitle="Continue with the account already open in this browser."
    >
      <InviteBanner token={inviteToken} headline={inviteHeadline} preview={invitePreview} />
      <div className="signin-step">
        <button type="button" className="signin-submit" disabled={working} onClick={onContinue}>
          {continueAsLabel(working, emailHint)}
        </button>
        <button
          type="button"
          className="signin-link signin-link-block"
          disabled={working}
          onClick={() => onSwitchAccount(`/signin?next=${encodeURIComponent(resolvedNext)}`)}
        >
          Use a different account
        </button>
      </div>
      <AccessFooter />
    </SignInCard>
  );
}
