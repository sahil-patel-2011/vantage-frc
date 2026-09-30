"use client";

import { Icon } from "./icon";
import { withOrgHref, type IslandTabDefinition, type ProductNavGroup } from "../lib/nav/product-nav";
import { PRODUCT_HUBS } from "../lib/nav/hubs";

/**
 * Persistent left rail for wide screens.
 *
 * The drawer/⌘K overlay stays the way you *search* the product; this rail is
 * the way you *move* between the six pillars without opening anything. It is
 * rendered on every page and hidden below 1024px by CSS, so narrow screens keep
 * the island + drawer they already had.
 */

/**
 * Always-available shortcuts, used when the member has not pinned them.
 *
 * Scouting is deliberately not here. The Scout workbench is one tap from the
 * Competition pillar, it is a chip in that hub's own TabBar, and the Event-day
 * page it belongs to ends in a "See all N in Scouting" link — listing it in the
 * rail as well put the same destination on one screen three times, which is the
 * exact thing this rail was brought back to fix.
 */
const QUICK_LINKS = [
  { href: "/rankings", label: "Stats", icon: "stats" as const },
  { href: "/ai?tab=chat", label: "Ask AI", icon: "bolt" as const },
];

function isCurrent(href: string, pathname: string, pathSearch: string) {
  const [path, query] = href.split("?");
  if (path !== pathname) return false;
  if (!query) return true;
  return pathSearch.includes(query);
}

/** `/competition?tab=scouting` and `/competition` name the same place at different depths. */
function hrefKey(href: string): string {
  const [path, query] = href.split("?");
  const tab = new URLSearchParams(query ?? "").get("tab");
  return tab ? `${path}?tab=${tab}` : (path ?? href);
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
  islandTabs,
  onEditApps,
}: {
  orgId: string;
  pathname: string;
  pathSearch: string;
  orgLabel: string;
  visibleNavGroups: ProductNavGroup[];
  navHrefAllowed: (href: string) => boolean;
  onOpenSearch: () => void;
  shortcutHint: string;
  islandTabs: IslandTabDefinition[];
  onEditApps: () => void;
}) {
  const rows = visibleNavGroups
    .flatMap((group) => (group.items[0] ? [group.items[0]] : []))
    .filter((item) => navHrefAllowed(item.href));
  const pillarHrefs = new Set(rows.map((item) => hrefKey(item.href)));
  /**
   * A pinned app that is a workbench of the hub you are standing in is already
   * on screen: the hub's own TabBar is a row of those names, directly above the
   * content. Listing "Scout" in the rail as well meant the same word, the same
   * icon and the same destination appeared on one screen twice, and a person
   * choosing between two identical controls has to work out which one is real.
   * The rail keeps the pinned apps that point somewhere else, so it stays a
   * shortcut rather than a second copy of the page.
   */
  const hubTabsHere = new Set(
    PRODUCT_HUBS.flatMap((hub) =>
      hub.href === pathname ? hub.tabs.map((tab) => hrefKey(`${hub.href}?tab=${tab.id}`)) : [],
    ),
  );
  const pinned = islandTabs.filter(
    (tab) => navHrefAllowed(tab.href) && !pillarHrefs.has(hrefKey(tab.href)) && !hubTabsHere.has(hrefKey(tab.href)),
  );
  const quick = QUICK_LINKS.filter(
    (item) => navHrefAllowed(item.href) && !pinned.some((tab) => hrefKey(tab.href) === hrefKey(item.href)),
  );

  return (
    <aside className="vrail" aria-label="Primary">
      <div className="vrail-head">
        <span className="vrail-mark">Vantage</span>
        <span className="vrail-org">{orgLabel}</span>
      </div>

      <button className="vrail-search" type="button" data-tour="menu" aria-controls="vantage-navigation-panel" onClick={onOpenSearch}>
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

      {/* No "Edit apps" button: it was on every page for something done once. Right-click these
          apps, or open Account → Appearance, to change them. */}
      <nav
        className="vrail-nav vrail-quick"
        aria-label="Your apps"
        data-tour="island"
        title="Right-click to change these apps (or Account → Appearance)"
        onContextMenu={(event) => {
          event.preventDefault();
          onEditApps();
        }}
      >
        <span className="vrail-label">Your apps</span>
        {pinned.map((item) => (
          <a
            key={item.href}
            href={withOrgHref(item.href, orgId)}
            data-tour={item.href.includes("tab=chat") ? "ask-ai" : undefined}
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
              data-tour={item.href.includes("tab=chat") ? "ask-ai" : undefined}
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
