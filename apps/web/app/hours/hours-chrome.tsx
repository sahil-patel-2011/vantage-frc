"use client";

import { Button, EmptyState, PageHeader } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import {
  HOURS_PAGE_BLURB,
  HOURS_PAGE_TITLE,
  HOURS_RELATED_INCLUDE,
  hoursRelatedLinks,
  hoursShellCopy,
} from "../../lib/hours/hours-related";
import type { LoadFailureCopy } from "../../lib/ui/load-failure";

export function HoursRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = hoursRelatedLinks(orgId, { include: [...HOURS_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related hours-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function HoursLoadShell({
  failure,
  onRetry,
}: {
  failure: LoadFailureCopy | null;
  onRetry: () => void;
}) {
  const copy = hoursShellCopy("loading");
  return (
    <main className="module-page hours-page">
      <PageHeader breadcrumbs="Team / Hours" title={HOURS_PAGE_TITLE} />
      <EmptyState
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : copy.description}
        soft
        aria-busy={!failure}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export function HoursSetupShell({
  message,
  fromCache,
  cachedAt,
}: {
  message: string;
  fromCache: boolean;
  cachedAt: string | null;
}) {
  const copy = hoursShellCopy("setup");
  return (
    <main className="module-page hours-page">
      <PageHeader breadcrumbs="Team / Hours" title={HOURS_PAGE_TITLE} description={HOURS_PAGE_BLURB}>
        <HoursRelatedStrip />
      </PageHeader>
      <OfflineBanner feature="Hours" fromCache={fromCache} cachedAt={cachedAt} />
      <EmptyState
        title={copy.title}
        description={message || copy.description}
        badge={copy.badge}
        badgeTone="setup"
        soft
      >
        <Button as="a" variant="primary" href="/workspace">
          Choose your team
        </Button>
      </EmptyState>
    </main>
  );
}
