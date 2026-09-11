"use client";

import { type ReactNode } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  STRATEGY_RELATED_INCLUDE,
  strategyRelatedLinks,
  strategyShellCopy,
  type StrategyShellKind,
  type StrategyShellNextAction,
} from "../../lib/strategy/strategy-related";
import type { StrategyView } from "../../lib/strategy/types";

export function StrategyRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = strategyRelatedLinks(orgId, {
    include: [...STRATEGY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related strategy-related" aria-label="Related strategy tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function StrategyNextActionsPanel({ actions }: { actions: StrategyShellNextAction[] }) {
  if (!actions.length) return null;
  return (
    <Panel className="strategy-next-actions-panel">
      <header>
        <h2>Next actions</h2>
        <p>Sync match results, then scout. This list stays empty until then.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
export function TbaKeyHint({ view }: { view: StrategyView }) {
  const access = view.tbaAccess;
  const stat = view.referenceAccess?.statbotics;
  if (access?.tbaConfigured && (stat?.cacheHasMetrics ?? true)) return null;
  return (
    <div className="strategy-reference-hints">
      {access && !access.tbaConfigured ? (
        <p className="telemetry-status" role="status">
          Match results are not connected. Open Team → Data, connect match results, and pick this event.
          Strategy stays empty until that schedule is in.
        </p>
      ) : null}
      {stat && !stat.cacheHasMetrics ? (
        <p className="telemetry-status" role="status">
          Team ratings have not synced yet ({stat.eventMetricRows} event / {stat.yearMetricRows} year rows). Open
          Team → Data and sync. Strategy stays empty until those ratings exist.
        </p>
      ) : null}
    </div>
  );
}

export type StrategyTab = "matchup" | "picks";

export function StrategyShell({
  orgId,
  shell,
  error,
  onRetry,
  embedded = false,
  fromCache = false,
  cachedAt = null,
  children,
}: {
  orgId?: string | null;
  shell: StrategyShellKind;
  error?: string;
  onRetry?: () => void;
  embedded?: boolean;
  fromCache?: boolean;
  cachedAt?: string | null;
  children?: ReactNode;
}) {
  const copy = strategyShellCopy(shell);
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const teamDataHref = withOrgHref("/team/data", orgId);
  const commandHref = hubHref("/competition", "command", orgId);

  const Root = embedded ? "div" : "main";

  return (
    <Root className={`module-page strategy-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Strategy"
        title="Strategy"
        description="Win/loss and pick lists use synced event numbers and your scout notes."
      >
        <div className="strategy-header-actions">
          <StrategyRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>
      )}
      <OfflineBanner feature="Strategy" fromCache={fromCache} cachedAt={cachedAt} />
      {children}
      <EmptyState
        soft
        className="strategy-shell-empty"
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? copy.badge
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? commandHref : workspaceHref}>{orgId ? "Set active event" : "Choose your team"}</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={teamDataHref}>Sync Team Data</Button>
        ) : null}
      </EmptyState>
    </Root>
  );
}
