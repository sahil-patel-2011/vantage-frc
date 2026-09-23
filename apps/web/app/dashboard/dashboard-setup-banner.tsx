"use client";

import type { ReactNode } from "react";
import { Badge, Button } from "../../components/ui";
import {
  dashboardSetupBannerLabel,
  dashboardSetupBannerPrimary,
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
  const primary = dashboardSetupBannerPrimary(shell, nextActions, setupSteps);
  const href = primary && "href" in primary ? primary.href : "#";
  const label = primary ? dashboardSetupBannerLabel(primary) : null;

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
