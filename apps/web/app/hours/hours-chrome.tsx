"use client";

import type { ReactNode } from "react";
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

const WAITLIST_PHRASE = "join the waitlist";

/** The no-team sentence names the waitlist in the same words as the link. */
function withWaitlistLink(text: string): ReactNode {
  const at = text.toLowerCase().indexOf(WAITLIST_PHRASE);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href="/#waitlist">{text.slice(at, at + WAITLIST_PHRASE.length)}</a>
      {text.slice(at + WAITLIST_PHRASE.length)}
    </>
  );
}

export function HoursRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = hoursRelatedLinks(orgId, { include: [...HOURS_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related hours-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

export function HoursLoadShell({
  failure,
  onRetry,
  fromCache = false,
  cachedAt = null,
}: {
  failure: LoadFailureCopy | null;
  onRetry: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  const copy = hoursShellCopy("loading");
  return (
    <main className="module-page hours-page">
      <PageHeader breadcrumbs="Team / Hours" title={HOURS_PAGE_TITLE} />
      <OfflineBanner feature="Hours" fromCache={fromCache} cachedAt={cachedAt} />
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
  offerWaitlist,
}: {
  message: string;
  fromCache: boolean;
  cachedAt: string | null;
  offerWaitlist: boolean;
}) {
  const copy = hoursShellCopy("setup");
  return (
    <main className={offerWaitlist ? "module-page hours-page hours-setup-page" : "module-page hours-page"}>
      <PageHeader
        breadcrumbs="Team / Hours"
        title={HOURS_PAGE_TITLE}
        description={offerWaitlist ? withWaitlistLink(message) : HOURS_PAGE_BLURB}
      >
        <HoursRelatedStrip />
      </PageHeader>
      <OfflineBanner feature="Hours" fromCache={fromCache} cachedAt={cachedAt} />
      <EmptyState
        title={copy.title}
        description={offerWaitlist ? withWaitlistLink(message) : message || copy.description}
        badge={copy.badge}
        badgeTone="setup"
        soft
        className={offerWaitlist ? "hours-setup" : undefined}
      >
        <div className={offerWaitlist ? "hours-setup-actions" : undefined}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          {offerWaitlist ? (
            <a className="hours-setup-waitlist" href="/#waitlist">
              Join the waitlist
            </a>
          ) : null}
        </div>
      </EmptyState>
    </main>
  );
}
