"use client";

import { type ReactNode } from "react";
import { LogisticsRelated } from "../../components/logistics-related";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  TextBlockSkeleton,
  CardGridSkeleton,
  Button,
} from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  LOGISTICS_RELATED_INCLUDE,
  logisticsShellCopy,
  type LogisticsShellKind,
  type LogisticsShellNextAction,
} from "../../lib/logistics/logistics-related";

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

export function LogisticsNextActionsPanel({ actions }: { actions: LogisticsShellNextAction[] }) {
  if (!actions.length) return null;
  return (
    <Panel className="log-next-actions edc-next-actions soft-panel">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant={action.primary ? "primary" : "secondary"} href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function LogisticsShell({
  orgId,
  shell,
  canManage,
  error,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: LogisticsShellKind;
  canManage?: boolean;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const copy = logisticsShellCopy(shell);
  if (shell === "loading") {
    return (
      <main className="log-page soft-gate">
        <PageHeader
          navPath="/logistics"
          title="Logistics"
          description="Hotels, rooming, travel legs, and day-of checklists."
        >
          <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
        </PageHeader>
        <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
        {children}
        <div aria-busy="true" aria-label="Loading logistics">
          <TextBlockSkeleton lines={2} />
          <div style={{ height: 16 }} />
          <CardGridSkeleton cols={2} rows={2} />
        </div>
      </main>
    );
  }

  if (shell === "error") {
    return (
      <main className="log-page soft-gate">
        <PageHeader
          navPath="/logistics"
          title="Logistics"
          description="Hotels, rooming, travel legs, and day-of checklists."
        >
          <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
        </PageHeader>
        <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
        {children}
        <ErrorState title={copy.title} message={error ?? copy.description} onRetry={onRetry} />
      </main>
    );
  }

  const setupText = error ?? copy.description;
  const offerWaitlist =
    shell === "setup" && !orgId && setupText.toLowerCase().includes(WAITLIST_PHRASE);
  return (
    <main className="log-page soft-gate">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description={
          offerWaitlist
            ? withWaitlistLink(setupText)
            : "Hotels, rooming, travel legs, and day-of checklists."
        }
      >
        <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
      </PageHeader>
      <TeamOpsNav orgId={orgId ?? undefined} active="logistics" />
      {children}
      <EmptyState
        soft
        badge={copy.badge}
        badgeTone="setup"
        title={copy.title}
        description={offerWaitlist ? withWaitlistLink(setupText) : setupText}
        className={offerWaitlist ? "log-setup" : undefined}
      >
        {offerWaitlist ? (
          <div className="log-setup-actions">
            <Button as="a" variant="primary" href={workspaceHref}>Choose your team</Button>
            <a className="log-setup-waitlist" href="/#waitlist">
              Join the waitlist
            </a>
          </div>
        ) : shell === "setup" ? (
          <Button as="a" variant="primary" href={workspaceHref}>Choose your team</Button>
        ) : null}
        {shell === "empty" && canManage ? (
          <Button as="a" variant="primary" href={withOrgHref("/logistics", orgId) + "#logistics-create-trip"}>
            Add a trip
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}
