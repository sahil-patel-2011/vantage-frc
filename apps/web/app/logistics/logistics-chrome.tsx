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
            <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
              Open
            </a>
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
      <EmptyState
        soft
        badge={copy.badge}
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
      >
        {shell === "setup" ? (
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
