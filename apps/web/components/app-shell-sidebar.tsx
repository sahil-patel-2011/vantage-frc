"use client";

import { Icon } from "./icon";
import { AskAiTopbarLink } from "./ask-ai-button";
import { islandTabIsActive } from "./app-shell-model";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { mainMenuSearch } from "../lib/nav/main-menu";
import type { PinDefinition } from "../lib/nav/pins";
import { workspacePickerHref } from "../lib/workspace";
import { tourTargetForHref } from "../lib/tour/tour-steps";

/**
 * The desktop sidebar: your pinned apps first (the same "Your apps" as the phone's bottom bar
 * and menu, edited in the same sheet), then every workspace, then help and account. The
 * workspaces are always listed, so un-pinning never hides anything.
 */
export function AppShellSidebar({ groups, pins, pathname, pathSearch, orgId, orgLabel, roleCue, collapsed, onCollapse, onEditPins, allowed }: {
  groups: ProductNavGroup[];
  /** "Your apps", already filtered to what this team may open. */
  pins: PinDefinition[];
  pathname: string; pathSearch: string; orgId: string; orgLabel: string;
  /** The person's role on this team, the same words the phone menu's team card shows. */
  roleCue?: string;
  collapsed: boolean; onCollapse: () => void; onEditPins: () => void; allowed: (href: string) => boolean;
}) {
  const activeSearch = mainMenuSearch(pathname, pathSearch, allowed);
  const pinnedHrefs = new Set(pins.map(pin => pin.href));
  // Home leads the workspaces when it isn't pinned, so it is always one click away.
  const workspaces = groups.flatMap(group => group.items).filter(item => !(item.href === "/dashboard" && pinnedHrefs.has("/dashboard")));
  return <aside className="app-sidebar" aria-label="Workspace sidebar" data-collapsed={collapsed}>
    <div className="app-sidebar-brand">
      <a href={withOrgHref("/dashboard", orgId)} aria-label="Vantage home"><img src="/vantage-mark.svg" width="30" height="30" alt="" /><span>Vantage</span></a>
      <button type="button" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><Icon name="sidebar" /></button>
    </div>
    <a className="app-sidebar-team" href={workspacePickerHref(pathname, pathSearch)} title="Switch team" aria-label={`Switch team — ${orgLabel}`}><i><Icon name="users" /></i><span><strong>{orgLabel}</strong><small>{orgId ? roleCue || "Switch team" : "Choose your team"}</small></span><Icon name="chevron" /></a>
    {pins.length > 0 ? <nav className="app-sidebar-pins" aria-labelledby="app-sidebar-pins-label">
      <div className="app-sidebar-label-row">
        <p className="app-sidebar-label" id="app-sidebar-pins-label">Pinned</p>
        <button type="button" className="app-sidebar-edit" onClick={onEditPins} aria-label="Edit pinned apps" title="Edit pinned apps">
          <Icon name="pencil" />
        </button>
      </div>
      {pins.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} title={item.label}
        aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </a>)}
    </nav> : null}
    <nav className="app-sidebar-main" aria-label="Workspaces">
      <p className="app-sidebar-label">Workspaces</p>
      {workspaces.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} title={item.label} data-tour={tourTargetForHref(item.href)}
        aria-current={pathname === item.href.split("?")[0] ? "page" : undefined}>
        <Icon name={item.icon} /><span>{item.label}</span>
      </a>)}
    </nav>
    <nav className="app-sidebar-footer" aria-label="Workspace utilities">
      {/* Ask AI opens on the current page's skill, the same link as the top bar's (lib/ai-skills). */}
      {allowed("/ai?tab=chat") ? <AskAiTopbarLink orgId={orgId || null} label="Ask AI" /> : null}
      {[{ href: "/help", label: "Help", icon: "book" as const }, { href: "/account", label: "Account", icon: "gear" as const }]
        .filter(item => allowed(item.href)).map(item => <a key={item.href} data-tour={item.href.startsWith("/ai?") ? "ask-ai" : undefined} title={item.label} href={withOrgHref(item.href, orgId)} aria-current={pathname === item.href.split("?")[0] ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
    </nav>
  </aside>;
}
