"use client";

import { useState } from "react";
import { Icon } from "./icon";
import { islandTabIsActive } from "./app-shell-model";
import { panelSubLinks, withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";

/** One workspace at a time; its tools remain one click away and searchable. */
export function AppShellNavGroups({ groups, activeGroupLabel, pathname, pathSearch, orgId, navHrefAllowed, closeNav }: {
  groups: ProductNavGroup[];
  activeGroupLabel?: string;
  pathname: string;
  pathSearch: string;
  orgId: string;
  navHrefAllowed: (href: string) => boolean;
  closeNav: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(activeGroupLabel ?? null);
  return groups.map((group) => {
    const item = group.items[0];
    if (!item || item.state === "planned") return null;
    const children = panelSubLinks(group).filter((entry) => navHrefAllowed(entry.href));
    const open = expanded === group.label;
    const id = `nav-workspace-${group.label.toLowerCase()}`;
    return (
      <div key={group.label} className="soft-nav-group" style={{ ["--tone" as string]: group.tone }}>
        <div className="soft-nav-workspace-row">
          <a className={`soft-drawer-hub${activeGroupLabel === group.label ? " is-active" : ""}`}
            href={withOrgHref(item.href, orgId)} onClick={closeNav}
            aria-current={islandTabIsActive(pathname, pathSearch, item.href) && !children.some((entry) => islandTabIsActive(pathname, pathSearch, entry.href)) ? "page" : undefined}>
            <i><Icon name={group.icon} /></i><span>{item.label}</span>
          </a>
          {children.length > 0 ? (
            <button className="soft-icon-btn soft-nav-expand" type="button"
              aria-label={`${open ? "Hide" : "Show"} ${group.label} tools`}
              aria-expanded={open} aria-controls={id}
              onClick={() => setExpanded(open ? null : group.label)}>
              <Icon name="chevron" />
            </button>
          ) : null}
        </div>
        {children.length > 0 ? (
          <div id={id} className="soft-nav-items" hidden={!open}>
            {children.map((entry) => (
              <a key={entry.href} href={withOrgHref(entry.href, orgId)} onClick={closeNav}
                aria-current={islandTabIsActive(pathname, pathSearch, entry.href) ? "page" : undefined}>
                <span>{entry.label}</span><Icon name="chevron" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  });
}
