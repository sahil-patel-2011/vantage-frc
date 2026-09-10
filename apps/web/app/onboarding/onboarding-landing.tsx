"use client";

import { buildOnboardingLanding } from "../../lib/onboarding";
import type { OnboardingDraft } from "../../lib/onboarding";
import type { OnboardingState } from "./onboarding-model";

export function LandingPanel({ state, draft }: { state: OnboardingState; draft: OnboardingDraft }) {
  const landing = buildOnboardingLanding({
    teamRole: draft.teamRole,
    crewRole: draft.crewRole || null,
    roleDescription: draft.roleDescription || null,
    primaryFocus: draft.primaryFocus,
    orgId: state.workspaceOrgId,
    orgName: state.workspaceOrgName,
    platformAdmin: state.platformAdmin,
  });

  return (
    <div className="onboarding-landing">
      <p className="onboarding-landing-summary">{landing.summary}</p>
      <ol className="onboarding-landing-list">
        {landing.firstFiveMinutes.map((link, index) => (
          <li key={link.key}>
            <a href={link.href}>
              <b aria-hidden="true">{index + 1}</b>
              <div>
                <strong>{link.label}</strong>
                <span>{link.detail}</span>
                <em>{link.reason}</em>
              </div>
            </a>
          </li>
        ))}
      </ol>
      <div className="onboarding-pending-actions">
        <a className="signin-submit" href={landing.primary.href}>{landing.primary.label}</a>
        {landing.secondary ? <a className="signin-link" href={landing.secondary.href}>{landing.secondary.label}</a> : null}
      </div>
    </div>
  );
}
