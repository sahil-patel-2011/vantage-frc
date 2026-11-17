"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { useDismiss } from "../hooks/use-dismiss";
import { pathAllowedByHubAccess, pathAllowedBySponsors, type ClientHubAccessRow } from "../lib/nav/hub-access-filter";
import { hubMoreTools, type HubMoreToolsGroup } from "../lib/nav/hub-more-tools";
import { hubNavigationSections } from "../lib/nav/hub-navigation";
import { hubById, type ProductHubDef } from "../lib/nav/hubs";
import { mainMenuSearch, mainMenuSections } from "../lib/nav/main-menu";
import { PRODUCT_NAV_GROUPS, withOrgHref } from "../lib/nav/product-nav";
import { URL_CHANGE_EVENT } from "../lib/nav/url-change";

/**
 * A place's sections, under its title: at most six (Competition is Scout · Teams · Match plan ·
 * Pick list · Event day · Our robot). The same list the sidebar and the phone menu hold, so a
 * section is one tap from its place on every screen size. Every other tool in the place is one
 * tap further, in More tools, grouped under its section; search finds them too.
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
  const hub = hubById(hubId);
  const onRow = new Set(hubNavigationSections(hub, hub.tabs).map((entry) => entry.id));
  const more = hubMoreTools(hub, onRow, allowed);
  const rowItems = section?.items ?? [];
  if (rowItems.length < 2 && !more.length) return null;
  const activeSearch = search === null ? null : mainMenuSearch(pathname, search, allowed);
  return (
    <div className="workspace-hub-bar">
      {rowItems.length >= 2 ? (
        <nav ref={navRef} className="workspace-hub-sections" aria-label={`${section?.label ?? hub.label} sections`}>
          {rowItems.map((item) => (
            <a key={item.href} href={withOrgHref(item.href, orgId)}
              aria-current={activeSearch !== null && islandTabIsActive(pathname, activeSearch, item.href) ? "page" : undefined}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      ) : null}
      {more.length ? <HubMoreTools groups={more} orgId={orgId} placeLabel={hub.label} /> : null}
    </div>
  );
}

function HubMoreTools({ groups, orgId, placeLabel }: { groups: HubMoreToolsGroup[]; orgId: string | null; placeLabel: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = () => {
    const node = ref.current;
    if (node?.contains(document.activeElement)) node.querySelector("summary")?.focus();
    node?.removeAttribute("open");
    setOpen(false);
  };
  const ref = useDismiss<HTMLDetailsElement>(open, close);
  return (
    <details ref={ref} className="workspace-hub-more" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-controls={panelId} aria-expanded={open}>
        <Icon name="grid" />
        <span>More tools</span>
      </summary>
      <div id={panelId} className="workspace-hub-more-panel" role="group" aria-label={`More ${placeLabel} tools`}>
        {groups.map((group) => (
          <ul key={group.id} aria-label={group.label}>
            <li aria-hidden="true" className="workspace-hub-more-label">{group.label}</li>
            {group.tools.map((tool) => (
              <li key={tool.id}>
                <a href={withOrgHref(tool.href, orgId)}>{tool.label}</a>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </details>
  );
}
