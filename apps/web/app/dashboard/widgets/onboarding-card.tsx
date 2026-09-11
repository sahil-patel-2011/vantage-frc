"use client";

import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { emptyHintFor } from "./widget-empty-copy";
import { WidgetShell as Shell } from "./widget-shell";
import { currentOnboardingStep, type OnboardingStep } from "./onboarding-card-model";

export type { OnboardingStep } from "./onboarding-card-model";
export { currentOnboardingStep } from "./onboarding-card-model";

/**
 * First-run Home card: one EmptyState primary for the next incomplete step.
 * Never a 6-row Done/Open checklist wall, and never "this unlocks live widgets".
 */
export function OnboardingChecklistCard({
  steps,
  payload,
  orgId,
}: {
  steps: OnboardingStep[];
  payload?: WidgetPayload;
  orgId: string;
}) {
  const current = currentOnboardingStep(steps);
  if (!current) {
    return (
      <Shell
        type="onboarding_checklist"
        title="Setup"
        payload={payload}
        emptyHint={emptyHintFor("onboarding_checklist")}
        orgId={orgId}
        preferChildren
      >
        <p>You&apos;re set. Home shows live cards when match, files, or chat data exists.</p>
      </Shell>
    );
  }
  return (
    <Shell
      type="onboarding_checklist"
      title="Setup"
      payload={payload}
      emptyHint={{
        title: current.label,
        body: current.detail,
        ctaHref: current.href,
        ctaLabel: current.label,
      }}
      orgId={orgId}
    />
  );
}
