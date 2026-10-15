"use client";

import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { mainMenuSearch, mainMenuSections } from "../lib/nav/main-menu";
import type { PinDefinition } from "../lib/nav/pins";

/**
 * The menu's body: "Your apps" (the person's pins, like a phone's dock, with Edit), Home, and
 * the four workspaces as disclosures of real links, the same four as the desktop sidebar. A
 * pinned place stays in its workspace too.
 */
export function AppShellNavGroups({ groups, pins, pathname, pathSearch, orgId, navHrefAllowed, closeNav, onEditPins }: {
  groups: ProductNavGroup[];
  /** The person's pins this team may open, in their order. */
  pins: PinDefinition[];
  activeGroupLabel?: string;
  pathname: string;
  pathSearch: string;
  orgId: string;
  navHrefAllowed: (href: string) => boolean;
  closeNav: () => void;
  onEditPins: () => void;
}) {
  const sections = mainMenuSections(groups, navHrefAllowed);
  const activeSearch = mainMenuSearch(pathname, pathSearch, navHrefAllowed);
  const isHere = (href: string) => islandTabIsActive(pathname, activeSearch, href) || pathname === href;
  return <>
    <div className="main-menu-pins-head">
      <p className="main-menu-heading" id="main-menu-pins-label">Your apps</p>
      <button type="button" className="main-menu-pins-edit" onClick={onEditPins} aria-label="Edit your apps">
        Edit
      </button>
    </div>
    <div className="main-menu-launch" role="group" aria-labelledby="main-menu-pins-label" data-count={pins.length}>
      {pins.map(item => <a key={item.href}
          className="main-menu-app" href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={isHere(item.href) ? "page" : undefined}>
          <i className="main-menu-symbol"><Icon name={item.icon} /></i><span><strong>{item.label}</strong></span>
        </a>)}
    </div>
    {navHrefAllowed("/dashboard") ? <a className="main-menu-home" href={withOrgHref("/dashboard", orgId)} onClick={closeNav} aria-current={pathname === "/dashboard" ? "page" : undefined}><Icon name="home" /><span>Home</span></a> : null}
    {sections.length > 0 ? <p className="main-menu-heading">Workspaces</p> : null}
    {sections.map(section => {
      const destinations = section.items;
      const current = pathname === `/${section.id}` || section.items.some(item => islandTabIsActive(pathname, activeSearch, item.href));
      return <details key={section.id} className="main-menu-section" data-current={current} open={current}>
      <summary><i className="main-menu-symbol"><Icon name={section.icon} /></i><span className="main-menu-section-copy"><strong>{section.label}</strong></span><Icon name="chevron" /></summary>
      <nav aria-label={section.label}>
        {destinations.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
      </nav>
    </details>;
    })}
  </>;
}
