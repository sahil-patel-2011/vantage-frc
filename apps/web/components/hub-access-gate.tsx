"use client";

import type { ReactNode } from "react";
import { EmptyState, PageHeader } from "./ui";
import {
  clientCanAccessHub,
  clientCanAccessHubTab,
  type ClientHubAccessRow,
  type ClientHubId,
} from "../lib/nav/hub-access-filter";
import { useClientAccessProfile } from "../lib/nav/use-client-access";

/** Soft-UI forbidden / funding-disabled shell — never hard-crash the route. */
export function SoftAccessDenied({
  breadcrumbs,
  title,
  badge = "Access limited",
  heading,
  description,
  actions,
}: {
  breadcrumbs: ReactNode;
  title: string;
  badge?: string;
  heading: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <main className="module-page soft-gate soft-access-denied">
      <PageHeader breadcrumbs={breadcrumbs} title={title} description={description} />
      <EmptyState soft badge={badge} badgeTone="setup" title={heading} description={description}>
        {actions ?? (
          <>
            <a className="app-button" href="/dashboard">
              Back to Home
            </a>
            <a className="app-button secondary" href="/docs">
              App manual
            </a>
          </>
        )}
      </EmptyState>
    </main>
  );
}

export function HubTabForbidden({
  hubLabel,
  tabLabel,
}: {
  hubLabel: string;
  tabLabel?: string;
}) {
  return (
    <section className="app-card soft-panel product-hub-setup soft-access-denied">
      <span className="app-badge setup">Access limited</span>
      <h2>{tabLabel ? `${tabLabel} is not available` : `${hubLabel} is not available`}</h2>
      <p className="app-muted">
        Your team admin limited which {hubLabel} sections you can open. Pick another tab, or ask an
        owner to update section access under Team → Security.
      </p>
      <div className="product-hub-setup-actions soft-btn-row">
        <a className="app-button" href="/dashboard">
          Back to Home
        </a>
        <a className="app-button secondary" href="/docs?q=hub+access">
          How section access works
        </a>
      </div>
    </section>
  );
}

export function SponsorsFundingForbidden({ breadcrumbs = "Business / Sponsors" }: { breadcrumbs?: ReactNode }) {
  return (
    <SoftAccessDenied
      breadcrumbs={breadcrumbs}
      title="Sponsors"
      badge="Not enabled"
      heading="Sponsor tools are off for this team"
      description="Your funding profile turns off sponsor CRM and related Soft-UI tools. An owner can re-enable sponsors under Team → Background."
      actions={
        <>
          <a className="app-button" href="/business">
            Open Business
          </a>
          <a className="app-button secondary" href="/team/background">
            Funding profile
          </a>
          <a className="app-button secondary" href="/docs?q=sponsors">
            App manual
          </a>
        </>
      }
    />
  );
}

/** Gate standalone sponsor Soft-UI pages when org funding disallows sponsors. */
export function SponsorsFundingGate({
  children,
  breadcrumbs,
}: {
  children: ReactNode;
  breadcrumbs?: ReactNode;
}) {
  const access = useClientAccessProfile();
  if (!access.ready) {
    return (
      <main className="module-page soft-gate" aria-busy>
        <PageHeader breadcrumbs={breadcrumbs ?? "Business / Sponsors"} title="Sponsors" description="Checking access…" />
        <EmptyState soft badge="Loading" title="Checking access…" description="Confirming your team funding profile." />
      </main>
    );
  }
  if (access.sponsorsAllowed === false) {
    return <SponsorsFundingForbidden breadcrumbs={breadcrumbs} />;
  }
  return <>{children}</>;
}

export function hubAccessBlocks(
  rows: ClientHubAccessRow[] | null | undefined,
  hubId: ClientHubId,
  tabId?: string,
): boolean {
  if (!clientCanAccessHub(rows, hubId)) return true;
  if (tabId && !clientCanAccessHubTab(rows, hubId, tabId)) return true;
  return false;
}
