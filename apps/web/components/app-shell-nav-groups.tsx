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
      {[{ href: "/dashboard", label: "Home", hint: "Your team workspace", icon: "home" as const },
        { href: "/competition?tab=scouting", label: "Scouting", hint: "Collect and compare", icon: "scout" as const }]
        .filter(item => navHrefAllowed(item.href)).map(item => <a key={item.href}
          className="main-menu-app" href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
          <Icon name={item.icon} /><strong>{item.label}</strong><small>{item.hint}</small>
        </a>)}
    </div>
    {sections.map(section => <details key={section.id} className="main-menu-section">
      <summary><Icon name={section.icon} /><strong>{section.label}</strong><Icon name="chevron" /></summary>
      <nav aria-label={section.label}>
        {section.items.map(item => <a key={item.href} href={withOrgHref(item.href, orgId)} onClick={closeNav}
          aria-current={islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>{item.label}</a>)}
      </nav>
    </details>)}
  </>;
}
