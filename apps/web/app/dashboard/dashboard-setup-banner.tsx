"use client";

import type { ReactNode } from "react";
import { Badge, Button } from "../../components/ui";
import { Icon } from "../../components/icon";
import {
  dashboardSetupBannerLabel,
  dashboardSetupBannerPrimary,
  dashboardSetupBlurb,
  dashboardSetupTitle,
  platformAdminNoTeamSetup,
  type DashboardNextAction,
  type DashboardSetupStep,
  type DashboardShellKind,
} from "../../lib/dashboard/dashboard-related";

export function DashboardSetupBanner({
  shell,
  nextActions,
  setupSteps,
  compact = false,
  platformAdmin = false,
}: {
  shell: DashboardShellKind;
  nextActions: DashboardNextAction[];
  setupSteps: DashboardSetupStep[];
  compact?: boolean;
  platformAdmin?: boolean;
}) {
  if (shell === "ready") return null;
  if (shell === "no_org" && platformAdmin) {
    const admin = platformAdminNoTeamSetup();
    return (
      <section className="dash-setup-banner" aria-label="First-run setup">
        <div>
          <Badge tone="setup">Setup</Badge>
          <h2>{admin.title}</h2>
          <p>{admin.blurb}</p>
        </div>
        <Button as="a" variant="primary" href={admin.href}>{admin.label}</Button>
      </section>
    );
  }
  const primary = dashboardSetupBannerPrimary(shell, nextActions, setupSteps);
  const href = primary && "href" in primary ? primary.href : "#";
  const label = primary ? dashboardSetupBannerLabel(primary) : null;

  if (compact && primary) {
    const title = shell === "setup" ? "No event selected" : "Match schedule isn’t connected";
    return (
      <section className="dash-setup-banner dash-context-prompt" aria-label="Competition setup" data-testid="dash-context-prompt">
        <span className="dash-context-icon" aria-hidden="true"><Icon name="calendar" /></span>
        <div>
          <h2>{title}</h2>
          <p>{primary.detail}</p>
        </div>
        <Button as="a" variant="secondary" href={href}>{primary.label}</Button>
      </section>
    );
  }

  return (
    <section className="dash-setup-banner" aria-label="First-run setup">
      <div>
        <Badge tone="setup">Setup</Badge>
        <h2>{dashboardSetupTitle(shell)}</h2>
        <p>{setupBlurb(shell)}</p>
      </div>
      {primary && label ? (
        <Button as="a" variant="primary" href={href}>
          {label}
        </Button>
      ) : null}
    </section>
  );
}

const WAITLIST_PHRASE = "join the waitlist";

/** The no-team sentence names the waitlist in the same words as the link. */
function setupBlurb(shell: DashboardShellKind): ReactNode {
  const text = dashboardSetupBlurb(shell);
  if (shell !== "no_org") return text;
  const at = text.indexOf(WAITLIST_PHRASE);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href="/#waitlist">{WAITLIST_PHRASE}</a>
      {text.slice(at + WAITLIST_PHRASE.length)}
    </>
  );
}
