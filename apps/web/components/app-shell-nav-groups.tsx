"use client";

import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";
import { mainMenuSearch, mainMenuSections } from "../lib/nav/main-menu";

/** One menu owns destinations; each disclosure has one column of real links. */
export function AppShellNavGroups({ groups, pathname, pathSearch, orgId, navHrefAllowed, closeNav }: {
  groups: ProductNavGroup[];
  activeGroupLabel?: string;
  pathname: string;
  pathSearch: string;
  orgId: string;
  navHrefAllowed: (href: string) => boolean;
  closeNav: () => void;
}) {
  const sections = mainMenuSections(groups, navHrefAllowed);
  const activeSearch = mainMenuSearch(pathname, pathSearch, navHrefAllowed);
  return <>
    <div className="main-menu-launch">
      {[{ href: "/dashboard", label: "Home", hint: "Your overview", icon: "home" as const },
        { href: "/competition?tab=scouting", label: "Scouting", hint: "Collect reports", icon: "scout" as const }]
        .filter(item => navHrefAllowed(item.href)).map(item => <a key={item.href}
          className="main-menu-app" href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
          <i className="main-menu-symbol"><Icon name={item.icon} /></i><span><strong>{item.label}</strong><small>{item.hint}</small></span>
        </a>)}
    </div>
    {sections.length > 0 ? <p className="main-menu-heading">Workspaces</p> : null}
    {sections.map(section => {
      const current = pathname === `/${section.id}` || section.items.some(item => islandTabIsActive(pathname, activeSearch, item.href));
      return <details key={section.id} className="main-menu-section" data-current={current} open={current}>
      <summary><i className="main-menu-symbol"><Icon name={section.icon} /></i><span className="main-menu-section-copy"><strong>{section.label}</strong><small>{section.items.slice(0, 3).map(item => item.label).join(" · ")}</small></span><Icon name="chevron" /></summary>
      <nav aria-label={section.label}>
        {section.items.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
      </nav>
    </details>;
    })}
  </>;
}
