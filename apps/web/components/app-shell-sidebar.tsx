"use client";

import { Icon } from "./icon";
import { withOrgHref, type ProductNavGroup } from "../lib/nav/product-nav";

/**
 * Persistent left rail for wide screens.
 *
 * The drawer/⌘K overlay stays the way you *search* the product; this rail is
 * the way you *move* between the six pillars without opening anything. It is
 * rendered on every page and hidden below 1024px by CSS, so narrow screens keep
 * the island + drawer they already had.
 */

const QUICK_LINKS = [
  { href: "/competition?tab=scouting", label: "Scouting", icon: "scout" as const },
  { href: "/analytics", label: "Analytics", icon: "stats" as const },
  { href: "/ai?tab=chat", label: "Ask AI", icon: "bolt" as const },
];

function isCurrent(href: string, pathname: string, pathSearch: string) {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (!query) return true;
  return pathSearch.includes(query);
}

export function AppShellSidebar({
  orgId,
  pathname,
  pathSearch,
  orgLabel,
  visibleNavGroups,
  navHrefAllowed,
  onOpenSearch,
  shortcutHint,
}: {
  orgId: string;
  pathname: string;
  pathSearch: string;
  orgLabel: string;
  visibleNavGroups: ProductNavGroup[];
  navHrefAllowed: (href: string) => boolean;
  onOpenSearch: () => void;
  shortcutHint: string;
}) {
  const rows = visibleNavGroups
    .flatMap((group) => (group.items[0] ? [group.items[0]] : []))
    .filter((item) => navHrefAllowed(item.href));
  const quick = QUICK_LINKS.filter((item) => navHrefAllowed(item.href));

  return (
    <aside className="vrail" aria-label="Primary">
      <div className="vrail-head">
        <span className="vrail-mark">Vantage</span>
        <span className="vrail-org">{orgLabel}</span>
      </div>

      <button className="vrail-search" type="button" onClick={onOpenSearch}>
        <Icon name="search" />
        <span>Search</span>
        {shortcutHint ? <kbd>{shortcutHint}</kbd> : null}
      </button>

      <nav className="vrail-nav" aria-label="Pillars">
        {rows.map((item) => (
          <a
            key={item.href}
            href={withOrgHref(item.href, orgId)}
            aria-current={isCurrent(item.href, pathname, pathSearch) ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      {quick.length > 0 ? (
        <nav className="vrail-nav vrail-quick" aria-label="Shortcuts">
          <span className="vrail-label">Shortcuts</span>
          {quick.map((item) => (
            <a
              key={item.href}
              href={withOrgHref(item.href, orgId)}
              aria-current={isCurrent(item.href, pathname, pathSearch) ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      ) : null}

      <a className="vrail-foot" href={withOrgHref("/account", orgId)}>
        <Icon name="gear" />
        <span>Settings</span>
      </a>
    </aside>
  );
}
