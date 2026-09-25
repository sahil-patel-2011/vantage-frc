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
    orgRole: state.workspaceRole,
  });

  // Keys are a team leader's job; students and parents are not asked about them.
  const leader = draft.teamRole !== "student" && draft.teamRole !== "parent";

  return (
    <div className="onboarding-landing">
      <p className="onboarding-landing-summary">{landing.summary}</p>
      {/* The way on is the first thing under "You're in", not below a list. */}
      <div className="onboarding-pending-actions">
        <a className="signin-submit" href={landing.primary.href}>{landing.primary.label}</a>
      </div>
      {leader && state.workspaceOrgId ? (
        <p className="onboarding-landing-ai">
          Want Ask AI? It runs on your team&rsquo;s own key, and a free Google Gemini key works.{" "}
          <a href={`/team/ai-keys?orgId=${encodeURIComponent(state.workspaceOrgId)}`}>Add one any time</a>.
        </p>
      ) : null}
      <h2 className="onboarding-landing-next">
        {landing.firstFiveMinutes[0]?.key.startsWith("team_setup:") ? "Team setup" : "Good first steps"}
      </h2>
      <ol className="onboarding-landing-list">
        {landing.firstFiveMinutes.map((link, index) => (
          <li key={link.key}>
            <a href={link.href}>
              <b aria-hidden="true">{index + 1}</b>
              <div>
                <strong>{link.label}</strong>
                <span>{link.detail}</span>
              </div>
            </a>
          </li>
        ))}
      </ol>
      {landing.secondary ? (
        <div className="onboarding-pending-actions">
          <a className="signin-link onboarding-landing-more" href={landing.secondary.href}>{landing.secondary.label}</a>
        </div>
      ) : null}
    </div>
  );
}
