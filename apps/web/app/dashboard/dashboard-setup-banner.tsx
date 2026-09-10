"use client";

import { Badge, Button } from "../../components/ui";
import {
  dashboardSetupBannerLabel,
  dashboardSetupBlurb,
  dashboardSetupTitle,
  type DashboardNextAction,
  type DashboardSetupStep,
  type DashboardShellKind,
} from "../../lib/dashboard/dashboard-related";

export function DashboardSetupBanner({
  shell,
  nextActions,
  setupSteps,
}: {
  shell: DashboardShellKind;
  nextActions: DashboardNextAction[];
  setupSteps: DashboardSetupStep[];
}) {
  if (shell === "ready") return null;
  const primary =
    nextActions.find((action) => action.primary) ??
    setupSteps.find((step) => step.state === "current") ??
    null;
  const href = primary && "href" in primary ? primary.href : "#";
  const label = primary ? dashboardSetupBannerLabel(primary) : null;

  return (
    <section className="dash-setup-banner" aria-label="First-run setup">
      <div>
        <Badge tone="setup">Setup</Badge>
        <h2>{dashboardSetupTitle(shell)}</h2>
        <p>{dashboardSetupBlurb(shell)}</p>
      </div>
      {primary && label ? (
        <Button as="a" variant="primary" href={href}>
          {label}
        </Button>
      ) : null}
    </section>
  );
}
