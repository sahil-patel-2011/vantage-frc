"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { pathAllowedByHubAccess, pathAllowedBySponsors, type ClientHubAccessRow } from "../lib/nav/hub-access-filter";
import { mainMenuSearch, mainMenuSections } from "../lib/nav/main-menu";
import { PRODUCT_NAV_GROUPS, withOrgHref } from "../lib/nav/product-nav";
import type { ProductHubDef } from "../lib/nav/hubs";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";

/**
 * A place's sections, under its title: Competition is Event day · Scout · Teams · Match plan ·
 * Our robot (and My Day, Pit TV). The same list the old sidebar disclosures and the phone menu
 * held, now in one spot on the page itself, so a section is one tap from its place on every
 * screen size. The section's other tools stay in its own "More tools" and in search.
 */
export function HubSections({ hubId, orgId, hubAccess, sponsorsAllowed }: {
  hubId: ProductHubDef["id"];
  orgId: string | null;
  hubAccess: ClientHubAccessRow[] | null;
  sponsorsAllowed: boolean | null;
}) {
  const pathname = usePathname() ?? "";
  // The hub switches tabs by rewriting the address; follow it so the current section moves too.
  // Null until the address is read: the server render would otherwise mark the default section.
  const [search, setSearch] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const read = () => setSearch(window.location.search);
    read();
    window.addEventListener(URL_CHANGE_EVENT, read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener(URL_CHANGE_EVENT, read);
      window.removeEventListener("popstate", read);
    };
  }, [pathname]);
  // On a phone the row scrolls sideways: keep the section you are in where you can see it.
  useEffect(() => {
    if (search === null) return;
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const row = navRef.current;
    if (!current || !row || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2);
  }, [search]);
  const allowed = (href: string) => pathAllowedByHubAccess(href, hubAccess) && pathAllowedBySponsors(href, sponsorsAllowed);
  const section = mainMenuSections(PRODUCT_NAV_GROUPS, allowed).find((entry) => entry.id === hubId);
  if (!section || section.items.length < 2) return null;
  const activeSearch = search === null ? null : mainMenuSearch(pathname, search, allowed);
  return (
    <nav ref={navRef} className="workspace-hub-sections" aria-label={`${section.label} sections`}>
      {section.items.map((item) => (
        <a key={item.href} href={withOrgHref(item.href, orgId)}
          aria-current={activeSearch !== null && islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}
