"use client";

import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { mainMenuSections, mainMenuSearch } from "../lib/nav/main-menu";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { workspacePickerHref } from "../lib/workspace";

/** The same permission-filtered destinations as search, available without a modal. */
export function AppShellSidebar({ groups, pathname, pathSearch, orgId, orgLabel, collapsed, onCollapse, allowed }: {
  groups: ProductNavGroup[]; pathname: string; pathSearch: string; orgId: string; orgLabel: string;
  collapsed: boolean; onCollapse: () => void; allowed: (href: string) => boolean;
}) {
  const sections = mainMenuSections(groups, allowed);
  const search = mainMenuSearch(pathname, pathSearch, allowed);
  const activeSection = sections.find(section => pathname === `/${section.id}`);
  const activeItems = activeSection?.id === "competition" && allowed("/competition?tab=scouting")
    ? [{ href: "/competition?tab=scouting", label: "Scout", icon: "scout" as const }, ...activeSection.items]
    : activeSection?.items ?? [];
  return <aside className="app-sidebar" aria-label="Workspace sidebar" data-collapsed={collapsed}>
    <div className="app-sidebar-brand">
      <a href={withOrgHref("/dashboard", orgId)} aria-label="Vantage home"><img src="/vantage-mark.svg" width="30" height="30" alt="" /><span>Vantage</span></a>
      <button type="button" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><Icon name="menu" /></button>
    </div>
    <a className="app-sidebar-team" href={workspacePickerHref(pathname, pathSearch)} title="Switch team" aria-label={`Switch team — ${orgLabel}`}><i><Icon name="users" /></i><span><strong>{orgLabel}</strong><small>Team workspace</small></span><Icon name="chevron" /></a>
    <nav className="app-sidebar-main" aria-label="Workspaces">
      <p className="app-sidebar-label">Workspace</p>
      {groups.flatMap(group => group.items).map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} title={item.label}
        aria-current={pathname === item.href.split("?")[0] ? "page" : undefined}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </a>)}
    </nav>
    {activeSection ? <nav className="app-sidebar-section" aria-label={`${activeSection.label} sections`}>
      <p className="app-sidebar-label">In this workspace</p>
      {activeItems.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)}
        aria-current={islandTabIsActive(pathname, search, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
    </nav> : <nav className="app-sidebar-section" aria-label="Daily tools">
      <p className="app-sidebar-label">Your day</p>
      {[{ href: "/my-day", label: "My day", icon: "calendar" as const }, { href: "/todos", label: "Team tasks", icon: "clipboard" as const }, { href: "/hours-self-view", label: "My hours", icon: "activity" as const }]
        .filter(item => allowed(item.href)).map(item => <a key={item.href} href={withOrgHref(item.href, orgId)}
          aria-current={pathname === item.href ? "page" : undefined}><Icon name={item.icon} />{item.label}</a>)}
    </nav>}
    <nav className="app-sidebar-footer" aria-label="Workspace utilities">
      {[{ href: "/ai?tab=chat", label: "Ask Vantage", icon: "sparkles" as const }, { href: "/help", label: "Help & guides", icon: "book" as const }, { href: "/account", label: "Settings", icon: "gear" as const }]
        .filter(item => allowed(item.href)).map(item => <a key={item.href} data-tour={item.href.startsWith("/ai?") ? "ask-ai" : undefined} title={item.label} href={withOrgHref(item.href, orgId)} aria-current={pathname === item.href.split("?")[0] ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
    </nav>
  </aside>;
}
