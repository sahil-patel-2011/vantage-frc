"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader, TabBar } from "./ui";
import { hubById, isHubTab, type ProductHubDef } from "../lib/nav/hubs";

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

export function ProductHubShell({ hubId, breadcrumbs, children, headerActions }: ProductHubShellProps) {
  const hub = hubById(hubId);
  const [tab, setTab] = useState(hub.defaultTab);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    setTab(readTab(hub));
    setOrgId(readOrgId());
  }, [hub]);

  const selectTab = useCallback(
    (next: string) => {
      if (!isHubTab(hub, next)) return;
      setTab(next);
      writeTabToUrl(next, hub.defaultTab);
    },
    [hub],
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
        value={tab}
        onChange={selectTab}
        tabs={hub.tabs.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      />
      <div className="product-hub-panel" data-hub-tab={tab}>
        {children({ tab, orgId, selectTab })}
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
        <a className="app-button" href="/workspace">Choose workspace</a>
      </section>
    );
  }
  return <>{children(orgId)}</>;
}