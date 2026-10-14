"use client";

import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { mainMenuSearch, mainMenuSections } from "../lib/nav/main-menu";
import type { PinDefinition } from "../lib/nav/pins";
import { SETTINGS_HREF, isSettingsPath } from "../lib/nav/settings-nav";
import { tourTargetForHref } from "../lib/tour/tour-steps";

/**
 * The desktop sidebar: your pinned apps first (the same "Your apps" as the phone's bottom bar
 * and menu, edited in the same sheet), then every workspace, then help and account. The
 * workspaces are always listed, so un-pinning never hides anything.
 */
export function AppShellSidebar({ groups, pins, pathname, pathSearch, orgId, orgLabel, platformAdmin, collapsed, onCollapse, onEditPins, allowed }: {
  groups: ProductNavGroup[];
  /** "Your apps", already filtered to what this team may open. */
  pins: PinDefinition[];
  pathname: string; pathSearch: string; orgId: string; orgLabel: string;
  platformAdmin?: boolean;
  collapsed: boolean; onCollapse: () => void; onEditPins: () => void; allowed: (href: string) => boolean;
}) {
  const activeSearch = mainMenuSearch(pathname, pathSearch, allowed);
  const pinnedHrefs = new Set(pins.map(pin => pin.href));
  // Home leads the workspaces when it isn't pinned, so it is always one click away.
  const sections = mainMenuSections(groups, allowed).filter(section => section.id !== "ai").map(section => ({
    ...section, items: section.items.filter(item => !pinnedHrefs.has(item.href)),
  })).filter(section => section.items.length > 0);
  return <aside className="app-sidebar" aria-label="Workspace sidebar" data-collapsed={collapsed}>
    <div className="app-sidebar-brand">
      <div className="app-sidebar-wordmark"><img src="/vantage-mark.svg" width="30" height="30" alt="" /><span>Vantage</span></div>
      <button type="button" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><Icon name="sidebar" /></button>
    </div>
    <div className="app-sidebar-team-context">
      <a className="app-sidebar-team" href={withOrgHref(orgId ? "/team" : "/account/teams", orgId)} title="Team overview"><i><Icon name="users" /></i><span><strong>{orgLabel}</strong><small>{orgId ? "Team overview" : "Choose your team"}</small></span><Icon name="chevron" /></a>
    </div>
    <div className="app-sidebar-navigation">
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
      {!pinnedHrefs.has("/dashboard") && allowed("/dashboard") ? <a href={withOrgHref("/dashboard", orgId)} title="Home" aria-current={pathname === "/dashboard" ? "page" : undefined}><Icon name="home" /><span>Home</span></a> : null}
      {sections.map(section => {
        const current = pathname === `/${section.id}` || section.items.some(item => islandTabIsActive(pathname, activeSearch, item.href));
        return collapsed ? <button type="button" key={section.id} className="app-sidebar-workspace-button" title={`Browse ${section.label}`} aria-label={`Browse ${section.label}: expand sidebar`} onClick={onCollapse}><Icon name={section.icon} /></button>
          : <details key={`${section.id}:${pathname}:${pathSearch}`} className="app-sidebar-workspace" open={current} data-current={current}>
            <summary data-tour={tourTargetForHref(`/${section.id}`)}><Icon name={section.icon} /><span>{section.label}</span><Icon name="chevron" /></summary>
            <nav aria-label={`${section.label} sections`}>
              {section.items.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
            </nav>
          </details>;
      })}
    </nav>
    </div>
    <nav className="app-sidebar-footer" aria-label="Workspace utilities">
      {platformAdmin ? <a className="app-sidebar-admin" href="/admin" title="Platform admin" aria-current={pathname.startsWith("/admin") ? "page" : undefined}><Icon name="shield" /><span>Admin</span></a> : platformAdmin === undefined ? <span className="app-sidebar-admin-placeholder" aria-hidden="true"><Icon name="shield" /><span>…</span></span> : null}
      {/* No Ask AI row here: the top bar's sparkles button is the one way in, on every screen size. */}
      {[{ href: "/help", label: "Help", icon: "book" as const }, { href: SETTINGS_HREF, label: "Settings", icon: "gear" as const }]
        .filter(item => allowed(item.href)).map(item => <a key={item.href} data-tour={item.href === "/help" ? "feedback" : undefined} title={item.label} href={withOrgHref(item.href, orgId)} aria-current={(item.href === SETTINGS_HREF ? isSettingsPath(pathname) : pathname === item.href.split("?")[0]) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
    </nav>
  </aside>;
}
