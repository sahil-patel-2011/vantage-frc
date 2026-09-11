"use client";

import { Button, EmptyState, PageHeader } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { BuildHubRelated } from "../../components/build-hub-related";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import {
  BATTERIES_BUILD_RELATED_INCLUDE,
  BATTERIES_TEAM_RELATED_INCLUDE,
  type BatteryNextAction,
} from "../../lib/battery/battery-related";
import type { LoadFailureCopy } from "../../lib/ui/load-failure";
import { batteryCrumbs, type HubEmbed, type ReadyView } from "./batteries-model";

export function BatteriesRelated({ orgId }: { orgId: string }) {
  return (
    <div className="batt-related">
      <TeamHubRelated orgId={orgId} active="batteries" include={[...BATTERIES_TEAM_RELATED_INCLUDE]} />
      <BuildHubRelated orgId={orgId} active="batteries" include={[...BATTERIES_BUILD_RELATED_INCLUDE]} />
    </div>
  );
}

export function BatteriesLoadShell({
  embed,
  failure,
  onRetry,
  fromCache = false,
  cachedAt = null,
}: {
  embed: HubEmbed | null;
  failure: LoadFailureCopy | null;
  onRetry: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  return (
    <main className="module-page batt-page">
      <PageHeader breadcrumbs={batteryCrumbs(embed)} title="Batteries" />
      {!embed ? <TeamOpsNav active="batteries" /> : null}
      <OfflineBanner feature="Batteries" fromCache={fromCache} cachedAt={cachedAt} />
      <EmptyState
        title={failure ? failure.title : "Loading batteries…"}
        description={failure ? failure.description : undefined}
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

export function BatteriesSetupShell({
  embed,
  message,
  fromCache,
  cachedAt,
}: {
  embed: HubEmbed | null;
  message: string;
  fromCache: boolean;
  cachedAt: string | null;
}) {
  return (
    <main className="module-page batt-page">
      <PageHeader
        breadcrumbs={batteryCrumbs(embed)}
        title="Batteries"
        description="Track charge cycles, assignment, and competition readiness for every pack — from real logs only."
      />
      {!embed ? <TeamOpsNav active="batteries" /> : null}
      <OfflineBanner feature="Batteries" fromCache={fromCache} cachedAt={cachedAt} />
      <EmptyState title="Choose your team" description={message} badge="Setup" badgeTone="setup" soft>
        <Button as="a" variant="primary" href="/workspace">
          Choose your team
        </Button>
      </EmptyState>
    </main>
  );
}

export function BatteriesNextActions({
  actions,
  ready = false,
}: {
  actions: BatteryNextAction[];
  ready?: boolean;
}) {
  return (
    <section className="batt-next-actions app-card soft-panel" aria-label="Next actions">
      {ready ? (
        <header>
          <h2>Next actions</h2>
          <p>Prioritized from your fleet — empty until packs and measurements exist.</p>
        </header>
      ) : (
        <h2>Next actions</h2>
      )}
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
    </section>
  );
}

export function BatteriesReadyHeader({
  embed,
  view,
  fromCache,
  cachedAt,
  error,
  okMessage,
  orgId,
}: {
  embed: HubEmbed | null;
  view: ReadyView;
  fromCache: boolean;
  cachedAt: string | null;
  error: string;
  okMessage: string;
  orgId: string;
}) {
  return (
    <>
      <PageHeader
        breadcrumbs={batteryCrumbs(embed)}
        title="Batteries"
        description={
          <>
            Charge cycles, assignment, and event readiness for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""}. Internal resistance and cycle counts come from the charges your team logs.
          </>
        }
      >
        {!embed ? (
          <div className="batt-header-actions">
            <BatteriesRelated orgId={orgId} />
          </div>
        ) : null}
      </PageHeader>
      <OfflineBanner feature="Batteries" fromCache={fromCache} cachedAt={cachedAt} />
      {!embed ? <TeamOpsNav orgId={orgId} active="batteries" /> : null}
      {error ? (
        <p className="batt-alert" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="batt-alert ok" role="status">
          {okMessage}
        </p>
      ) : null}
    </>
  );
}

export function BatteriesSummary({ view }: { view: ReadyView }) {
  return (
    <section className="batt-summary" aria-label="Fleet summary">
      <article className="batt-summary-tile">
        <strong>{view.summary.active}</strong>
        <span>Active packs</span>
      </article>
      <article className="batt-summary-tile ready">
        <strong>{view.summary.competitionReady}</strong>
        <span>Competition ready</span>
      </article>
      <article className={`batt-summary-tile${view.summary.needAttention ? " warn" : ""}`}>
        <strong>{view.summary.needAttention}</strong>
        <span>Need attention</span>
      </article>
      <article className="batt-summary-tile ready">
        <strong>{view.summary.cartReady}</strong>
        <span>Cart ready</span>
      </article>
      <article className={`batt-summary-tile${view.summary.cartCooling ? " warn" : ""}`}>
        <strong>{view.summary.cartCooling}</strong>
        <span>Cooling</span>
      </article>
    </section>
  );
}
