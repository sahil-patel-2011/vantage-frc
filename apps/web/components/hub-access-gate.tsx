"use client";

import type { ReactNode } from "react";
import { Button, EmptyState, PageHeader } from "./ui";
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
      <PageHeader breadcrumbs={breadcrumbs} title={title} />
      <EmptyState soft badge={badge} badgeTone="setup" title={heading} description={description}>
        {actions ?? (
          <>
            <Button as="a" variant="primary" href="/dashboard">
              Back to Home
            </Button>
            <Button as="a" variant="secondary" href="/docs">
              App manual
            </Button>
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
        <Button as="a" variant="primary" href="/dashboard">
          Back to Home
        </Button>
        <Button as="a" variant="secondary" href="/docs?q=hub+access">
          How section access works
        </Button>
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
      description="Your funding profile turns off sponsor CRM and the tools that depend on it. An owner can re-enable sponsors under Team → Background."
      actions={
        <>
          <Button as="a" variant="primary" href="/business">
            Open Business
          </Button>
          <Button as="a" variant="secondary" href="/team/background">
            Funding profile
          </Button>
          <Button as="a" variant="secondary" href="/docs?q=sponsors">
            App manual
          </Button>
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
        <PageHeader breadcrumbs={breadcrumbs ?? "Business / Sponsors"} title="Sponsors" />
        <EmptyState soft badge="Loading" title="Opening Sponsors…" />
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
