"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { HubTabForbidden } from "./hub-access-gate";
import { EmptyState, PageHeader, TabBar } from "./ui";
import {
  clientCanAccessHub,
  filterTabsByHubAccess,
  type ClientHubId,
} from "../lib/nav/hub-access-filter";
import {
  hubById,
  hubLegacyHref,
  hubNestedTabs,
  hubPrimaryTabs,
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
      <a className="app-button secondary" href={href}>
        Continue
      </a>
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
      <a className="app-button secondary" href={href}>
        Continue
      </a>
    </section>
  );
}

export function ProductHubShell({ hubId, breadcrumbs, children, headerActions }: ProductHubShellProps) {
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
  const nestedTabs = useMemo(() => {
    const all = hubNestedTabs(hub, workbenchId);
    if (all.length <= 1) return [];
    if (hub.id === "team" && (workbenchId === "calendar" || workbenchId === "messages" || workbenchId === "knowledge")) {
      return [];
    }
    if (primaryTabs.some((entry) => entry.id === workbenchId)) return all;
    return filterTabsByHubAccess(all, access.hubAccess, accessHubId);
  }, [access.hubAccess, accessHubId, hub, primaryTabs, workbenchId]);

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
          <a className="app-button" href="/dashboard">
            Home
          </a>
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
      <TabBar
        aria-label={`${hub.label} sections`}
        value={workbenchId}
        onChange={selectTab}
        tabs={primaryTabs.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      />
      {nestedTabs.length > 1 ? (
        <label className="product-hub-tools">
          <span>In this section</span>
          <select value={tab} onChange={(event) => selectTab(event.target.value)} aria-label={`${hub.label} tools`}>
            {nestedTabs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="product-hub-panel" data-hub-tab={tab}>
        {(() => {
          if (!orgReady) {
            return (
              <EmptyState
                soft
                aria-busy
                badge="Loading"
                title="Opening workspace"
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
        <h2>Choose a team</h2>
        <p className="app-muted">{label} needs a team selected.</p>
        <div className="product-hub-setup-actions">
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </div>
      </section>
    );
  }
  return <>{children(orgId)}</>;
}
