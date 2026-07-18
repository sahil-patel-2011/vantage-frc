"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader, TabBar } from "./ui";
import {
  hubById,
  hubLegacyHref,
  hubMoreTabs,
  hubPrimaryTabs,
  isHubTab,
  type ProductHubDef,
} from "../lib/nav/hubs";
import { withOrgHref } from "../lib/nav/product-nav";

type ProductHubShellProps = {
  hubId: ProductHubDef["id"];
  breadcrumbs?: ReactNode;
  children: (ctx: { tab: string; orgId: string | null; selectTab: (tab: string) => void }) => ReactNode;
  headerActions?: ReactNode;
};

function readOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("orgId");
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
  const primaryTabs = hubPrimaryTabs(hub);
  const moreTabs = hubMoreTabs(hub);
  const [tab, setTab] = useState(hub.defaultTab);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    setTab(readTab(hub));
    setOrgId(readOrgId());
  }, [hub]);

  const selectTab = useCallback(
    (next: string) => {
      if (!isHubTab(hub, next)) return;
      const def = hub.tabs.find((entry) => entry.id === next);
      // Non-primary tools live as standalone pages — jump there instead of a blank panel.
      if (def?.primary === false && def.legacyHref && typeof window !== "undefined") {
        window.location.assign(hubLegacyHref(def, orgId));
        return;
      }
      setTab(next);
      writeTabToUrl(next, hub.defaultTab);
    },
    [hub, orgId],
  );

  return (
    <main className={`module-page product-hub product-hub--${hub.id}`}>
      <PageHeader
        breadcrumbs={breadcrumbs ?? `${hub.label} hub`}
        title={hub.title}
        description={hub.description}
      >
        {headerActions}
      </PageHeader>
      <TabBar
        aria-label={`${hub.label} sections`}
        value={primaryTabs.some((entry) => entry.id === tab) ? tab : hub.defaultTab}
        onChange={selectTab}
        tabs={primaryTabs.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      />
      {moreTabs.length ? (
        <details className="product-hub-more">
          <summary>More tools ({moreTabs.length})</summary>
          <div className="product-hub-more-links">
            {moreTabs.map((entry) => (
              <a key={entry.id} href={hubLegacyHref(entry, orgId)}>
                {entry.label}
              </a>
            ))}
          </div>
        </details>
      ) : null}
      <div className="product-hub-panel" data-hub-tab={tab}>
        {(() => {
          const active = hub.tabs.find((entry) => entry.id === tab);
          if (active?.primary === false && active.legacyHref) {
            return <HubLegacyOpen label={active.label} href={hubLegacyHref(active, orgId)} />;
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
        <span className="app-badge setup">Workspace</span>
        <h2>Select a workspace</h2>
        <p className="app-muted">Open {label} from a team workspace so data stays org-scoped.</p>
        <a className="app-button" href="/workspace">
          Choose workspace
        </a>
      </section>
    );
  }
  return <>{children(orgId)}</>;
}
