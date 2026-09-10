"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { HelpTip } from "./help-tip";
import { HubTabForbidden } from "./hub-access-gate";
import { OfflineBanner } from "./offline-banner";
import { EmptyState, PageHeader, TabBar, ToolStrip, Button } from "./ui";
import { sectionHelpFor } from "../lib/help/section-help";
import {
  clientCanAccessHub,
  filterTabsByHubAccess,
  type ClientHubId,
} from "../lib/nav/hub-access-filter";
import {
  hubById,
  hubLegacyHref,
  hubPrimaryTabs,
  hubStripTabs,
  hubWorkbenchId,
  isHubTab,
  type ProductHubDef,
} from "../lib/nav/hubs";
import { withOrgHref } from "../lib/nav/product-nav";
import { fetchActiveOrgId, persistOrgIdInUrl, readOrgIdFromSearch } from "../lib/nav/resolve-org";
import { useClientAccessProfile } from "../lib/nav/use-client-access";

type ProductHubShellProps = {
  hubId: ProductHubDef["id"];
  breadcrumbs?: ReactNode;
  children: (ctx: { tab: string; orgId: string | null; selectTab: (tab: string) => void }) => ReactNode;
  headerActions?: ReactNode;
  /**
   * Tab ids this hub renders inline. Tools not listed live on their own route,
   * so their chips link straight there instead of switching the tab and then
   * redirecting. An omitted or stale id degrades to the old redirect, never to
   * a dead end.
   */
  embeddedTabs?: readonly string[];
};

function readOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return readOrgIdFromSearch(window.location.search);
}

function readTab(hub: ProductHubDef): string {
  if (typeof window === "undefined") return hub.defaultTab;
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isHubTab(hub, tab) ? tab : hub.defaultTab;
}

function writeTabToUrl(tab: string, defaultTab: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === defaultTab) url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Soft-UI hubs only embed a subset of tabs. Non-primary / non-embedded tabs with
 * `legacyHref` navigate to the standalone route so drawer/hub links never dead-end.
 */
export function HubLegacyRedirect({
  hubId,
  tab,
  orgId,
}: {
  hubId: ProductHubDef["id"];
  tab: string;
  orgId: string | null;
}) {
  const hub = hubById(hubId);
  const def = hub.tabs.find((entry) => entry.id === tab);
  const href = def?.legacyHref ? withOrgHref(def.legacyHref, orgId) : null;

  useEffect(() => {
    if (href) window.location.replace(href);
  }, [href]);

  if (!href) {
    return (
      <section className="app-card soft-panel product-hub-setup">
        <span className="app-badge setup">Unavailable</span>
        <h2>This section is not available</h2>
        <p className="app-muted">Pick another tab in {hub.label}, or open the feature from the app menu.</p>
      </section>
    );
  }

  return (
    <section className="app-card soft-panel product-hub-setup" aria-busy>
      <span className="app-badge">Opening</span>
      <h2>{def?.label ?? "Feature"}</h2>
      <p className="app-muted">Taking you to the full page…</p>
      <Button as="a" variant="secondary" href={href}>
        Continue
      </Button>
    </section>
  );
}

/** Manual open card when a hub already resolved the destination href. */
export function HubLegacyOpen({ label, href }: { label: string; href: string }) {
  useEffect(() => {
    if (href) window.location.replace(href);
  }, [href]);

  return (
    <section className="app-card soft-panel product-hub-setup" aria-busy>
      <span className="app-badge">Opening</span>
      <h2>{label}</h2>
      <p className="app-muted">Taking you to the full page…</p>
      <Button as="a" variant="secondary" href={href}>
        Continue
      </Button>
    </section>
  );
}

export function ProductHubShell({
  hubId,
  breadcrumbs,
  children,
  headerActions,
  embeddedTabs,
}: ProductHubShellProps) {
  const hub = hubById(hubId);
  const access = useClientAccessProfile();
  const accessHubId = hubId as ClientHubId;
  const primaryTabs = useMemo(
    () => filterTabsByHubAccess(hubPrimaryTabs(hub), access.hubAccess, accessHubId),
    [access.hubAccess, accessHubId, hub],
  );
  const hubDenied = access.ready && !clientCanAccessHub(access.hubAccess, accessHubId);
  const [tab, setTab] = useState(hub.defaultTab);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgReady, setOrgReady] = useState(false);
  const workbenchId = hubWorkbenchId(hub, tab);
  /** Tools inside the open workbench — the workbench root itself is the tab above. */
  const toolTabs = useMemo(() => {
    const inner = hubStripTabs(hub, workbenchId, tab).filter((entry) => entry.group === workbenchId);
    if (!inner.length) return [];
    if (primaryTabs.some((entry) => entry.id === workbenchId)) return inner;
    return filterTabsByHubAccess(inner, access.hubAccess, accessHubId);
  }, [access.hubAccess, accessHubId, hub, primaryTabs, tab, workbenchId]);

  useEffect(() => {
    let cancelled = false;
    setTab(readTab(hub));
    const fromUrl = readOrgId();
    if (fromUrl) {
      setOrgId(fromUrl);
      setOrgReady(true);
      return () => {
        cancelled = true;
      };
    }
    setOrgReady(false);
    void fetchActiveOrgId().then((fromMe) => {
      if (cancelled) return;
      setOrgId(fromMe);
      if (fromMe) persistOrgIdInUrl(fromMe);
      setOrgReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hub]);

  useEffect(() => {
    if (!access.ready || hubDenied || !primaryTabs.length) return;
    if (primaryTabs.some((entry) => entry.id === tab || entry.id === hubWorkbenchId(hub, tab))) return;
    const fallback = primaryTabs[0]?.id ?? hub.defaultTab;
    setTab(fallback);
    writeTabToUrl(fallback, hub.defaultTab);
  }, [access.ready, hub, hubDenied, primaryTabs, tab]);

  const selectTab = useCallback(
    (next: string) => {
      if (!isHubTab(hub, next)) return;
      if (access.ready && !clientCanAccessHub(access.hubAccess, accessHubId)) return;
      if (access.ready && primaryTabs.length) {
        const workbench = hubWorkbenchId(hub, next);
        if (!primaryTabs.some((entry) => entry.id === workbench)) return;
      }
      setTab(next);
      writeTabToUrl(next, hub.defaultTab);
    },
    [access.hubAccess, access.ready, accessHubId, hub, primaryTabs],
  );

  if (access.ready && hubDenied) {
    return (
      <main className={`module-page product-hub product-hub--${hub.id} soft-gate`}>
        <PageHeader breadcrumbs={breadcrumbs} title={hub.title}>
          {headerActions}
        </PageHeader>
        <EmptyState
          soft
          badge="Access limited"
          badgeTone="setup"
          title={`${hub.label} is not available`}
          description="Your access to this section is limited. Ask an owner to update it under Security."
        >
          <Button as="a" variant="primary" href="/dashboard">
            Home
          </Button>
        </EmptyState>
      </main>
    );
  }

  const tabAllowed =
    !access.ready ||
    primaryTabs.some((entry) => entry.id === tab || entry.id === workbenchId);

  return (
    <main className={`module-page product-hub product-hub--${hub.id}`}>
      <PageHeader breadcrumbs={breadcrumbs} title={hub.title}>
        {headerActions}
      </PageHeader>
      <OfflineBanner feature={hub.label} />
      <TabBar
        aria-label={`${hub.label} sections`}
        value={workbenchId}
        onChange={selectTab}
        tabs={primaryTabs.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      >
        {/* How / why / when for whatever is open. Prefers the leaf tool's entry
            and falls back to its workbench; renders nothing when neither has one. */}
        <HelpTip entry={sectionHelpFor(hub.id, tab) ?? sectionHelpFor(hub.id, workbenchId)} />
      </TabBar>
      {/* The workbench root is the tab that is already selected one row up, so
          repeating it here put the same label ("Event day", "Kickoff") on the
          page twice. The strip lists only the tools inside the open workbench;
          the tab above is how you get back to its own screen. */}
      {toolTabs.length > 0 ? (
        <ToolStrip
          aria-label={`Tools in ${hub.tabs.find((entry) => entry.id === workbenchId)?.label ?? hub.label}`}
          value={tab}
          onChange={selectTab}
          describe={(id) => sectionHelpFor(hub.id, id)?.what}
          items={toolTabs.map((entry) => ({
            id: entry.id,
            label: entry.label,
            featured: entry.featured === true,
            href:
              embeddedTabs && !embeddedTabs.includes(entry.id) && entry.legacyHref
                ? hubLegacyHref(entry, orgId)
                : undefined,
          }))}
        />
      ) : null}
      <div className="product-hub-panel" data-hub-tab={tab}>
        {(() => {
          if (!orgReady) {
            return (
              <EmptyState
                soft
                aria-busy
                badge="Loading"
                title="Opening your team"
                description={`Loading ${hub.label} for your team.`}
              />
            );
          }
          if (access.ready && !tabAllowed) {
            const active = hub.tabs.find((entry) => entry.id === tab);
            return <HubTabForbidden hubLabel={hub.label} tabLabel={active?.label} />;
          }
          return children({ tab, orgId, selectTab });
        })()}
      </div>
    </main>
  );
}

export function HubOrgGate({
  orgId,
  label,
  children,
}: {
  orgId: string | null;
  label: string;
  children: (orgId: string) => ReactNode;
}) {
  if (!orgId) {
    return (
      <section className="app-card soft-panel product-hub-setup">
        <span className="app-badge setup">Team needed</span>
        <h2>Choose your team</h2>
        <p className="app-muted">{label} needs a team selected.</p>
        <div className="product-hub-setup-actions">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </div>
      </section>
    );
  }
  return <>{children(orgId)}</>;
}
