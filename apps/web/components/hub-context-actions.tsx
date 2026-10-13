"use client";
import { visibleContextActions } from "../lib/nav/hub-navigation";
import { hubHref, type HubTabDef, type ProductHubDef } from "../lib/nav/hubs";
export function HubContextActions({ hub, tab, tabs, orgId }: {
  hub: ProductHubDef; tab: string; tabs: readonly HubTabDef[]; orgId: string | null; canManage: boolean;
}) {
  const actions = visibleContextActions(hub, tab, tabs);
  if (!actions.length) return null;
  return <nav className="hub-context-actions" aria-label={`${hub.tabs.find(entry => entry.id === tab)?.label ?? hub.label} actions`}>
    {actions.map(action => <a key={action.id} href={hubHref(hub.href, action.id, orgId)}>{action.label}<span aria-hidden="true"> →</span></a>)}
  </nav>;
}
