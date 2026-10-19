"use client";

import { Icon } from "./icon";
import { VantageMark } from "./vantage-mark";
import { islandTabIsActive } from "./app-shell-model";
import { withOrgHref } from "../lib/nav/product-nav";
import { mainMenuSearch } from "../lib/nav/main-menu";
import type { Place, PlaceId } from "../lib/nav/places";
import type { PinDefinition } from "../lib/nav/pins";
import { tourTargetForHref } from "../lib/tour/tour-steps";

/**
 * The desktop sidebar: the team you're in, the five places (the same five as the phone's bottom
 * bar), then your pins. Nothing else: a place's sections are its segmented tabs, Ask AI is the
 * search field, and Settings, Help and Admin are in the account menu.
 */
export function AppShellSidebar({ places, currentPlace, pins, pathname, pathSearch, orgId, orgLabel, collapsed, onCollapse, onEditPins, allowed }: {
  places: Place[];
  currentPlace: PlaceId | null;
  /** Pins this team may open, less any pin to a place itself. */
  pins: PinDefinition[];
  pathname: string; pathSearch: string; orgId: string; orgLabel: string;
  collapsed: boolean; onCollapse: () => void; onEditPins: () => void; allowed: (href: string) => boolean;
}) {
  const activeSearch = mainMenuSearch(pathname, pathSearch, allowed);
  return <aside className="app-sidebar" aria-label="Sidebar" data-collapsed={collapsed}>
    <div className="app-sidebar-brand">
      <div className="app-sidebar-wordmark"><VantageMark size={30} /><span>Vantage</span></div>
      <button type="button" onClick={onCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><Icon name="sidebar" /></button>
    </div>
    <div className="app-sidebar-team-context">
      <a className="app-sidebar-team" href={withOrgHref("/account/teams", orgId)} title="Your teams"><i><Icon name="users" /></i><span><strong>{orgLabel}</strong><small>{orgId ? "Switch team" : "Choose your team"}</small></span><Icon name="chevron" /></a>
    </div>
    <div className="app-sidebar-navigation">
      <nav className="app-sidebar-main app-sidebar-places" aria-label="Places">
        {places.map((place) => (
          <a key={place.id} href={withOrgHref(place.href, orgId)} title={place.label} data-tour={tourTargetForHref(place.href)}
            aria-current={currentPlace === place.id ? "page" : undefined}>
            <Icon name={place.icon} /><span>{place.label}</span>
          </a>
        ))}
      </nav>
      <nav className="app-sidebar-pins" aria-labelledby="app-sidebar-pins-label">
        <div className="app-sidebar-label-row">
          <p className="app-sidebar-label" id="app-sidebar-pins-label">Pinned</p>
          <button type="button" className="app-sidebar-edit" onClick={onEditPins} aria-label="Edit pinned places" title="Edit pinned places">
            <Icon name="pencil" />
          </button>
        </div>
        {pins.length > 0 ? pins.map((item) => <a key={item.href} href={withOrgHref(item.href, orgId)} title={item.label}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </a>) : collapsed ? null : <button type="button" className="app-sidebar-pin-empty" onClick={onEditPins}><Icon name="plus" /><span>Pin a tool</span></button>}
      </nav>
    </div>
  </aside>;
}
