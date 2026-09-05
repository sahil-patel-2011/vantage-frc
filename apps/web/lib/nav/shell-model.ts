/**
 * Shell navigation model — the one shape the hamburger drawer (phones) and the
 * persistent sidebar (laptops) both render.
 *
 * Two disclosure levels and no more (hub → workbench). Deep tools stay in the
 * hub's ToolStrip and in ⌘K; the shell never grows a third tier. Everything
 * here is pure so it can be unit-tested without React.
 */
import { commandCatalog } from "./command-search";
import { hubHref, hubPrimaryTabs, navHubByLabel } from "./hubs";
import {
  LOGISTICS_DEEP_LINKS,
  PRODUCT_NAV_GROUPS,
  type ProductNavIcon,
} from "./product-nav";

export type ShellTab = { id: string; label: string; href: string; current: boolean };

export type ShellHub = {
  id: string;
  label: string;
  icon: ProductNavIcon;
  href: string;
  active: boolean;
  tabs: ShellTab[];
};

export type ShellQuickAction = {
  id: string;
  label: string;
  href: string;
  icon: ProductNavIcon;
  tone?: "primary";
  badge?: number;
};

export type ShellRecent = { href: string; label: string; context: string };

type BuildHubsInput = {
  pathname: string;
  search: string;
  activeGroupLabel?: string | null;
  isAllowed: (href: string) => boolean;
};

function pathOnly(href: string): string {
  return href.split("?")[0] || href;
}

function tabOf(href: string): string | null {
  const q = href.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(href.slice(q + 1)).get("tab");
}

/**
 * Hubs with their workbench tabs, filtered by hub access and sponsor rules.
 * Home carries no tabs (it is the dashboard); Logistics uses its deep links.
 */
export function buildShellHubs(input: BuildHubsInput): ShellHub[] {
  const liveTab = new URLSearchParams(input.search.replace(/^\?/, "")).get("tab");
  const hubs: ShellHub[] = [];
  for (const group of PRODUCT_NAV_GROUPS) {
    const item = group.items[0];
    if (!item || item.state === "planned") continue;
    if (!input.isAllowed(item.href)) continue;
    let tabs: Array<{ id: string; label: string; href: string }> = [];
    if (group.label === "Logistics") {
      tabs = [
        { id: "logistics", label: "Travel & hotels", href: "/logistics" },
        ...LOGISTICS_DEEP_LINKS.map((row) => ({ id: pathOnly(row.href).slice(1), label: row.label, href: row.href })),
      ];
    } else if (group.label !== "Home") {
      const hub = navHubByLabel(group.label);
      if (hub) {
        tabs = hubPrimaryTabs(hub).map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: hubHref(hub.href, tab.id),
        }));
      }
    }
    const hub = navHubByLabel(group.label);
    const onHubPath = input.pathname === pathOnly(item.href);
    const active = input.activeGroupLabel === group.label;
    hubs.push({
      id: group.label.toLowerCase(),
      label: group.label,
      icon: group.icon,
      href: item.href,
      active,
      tabs: tabs
        .filter((tab) => input.isAllowed(tab.href))
        .map((tab) => {
          const hrefTab = tabOf(tab.href);
          const current =
            group.label === "Logistics"
              ? input.pathname === pathOnly(tab.href)
              : onHubPath && (liveTab === hrefTab || (!liveTab && hrefTab === hub?.defaultTab));
          return { ...tab, current };
        }),
    });
  }
  return hubs;
}

type QuickActionInput = {
  /** True when a next match is known (event focus rail is live). */
  eventLive: boolean;
  unreadMessages?: number;
  isAllowed: (href: string) => boolean;
};

/**
 * The persistent "wipers and hazards" set (design rule R10): four actions a
 * member can hit without reading a menu. Event day swaps them for the
 * competition-critical five; the rest of the year they are the daily four.
 */
export function shellQuickActions(input: QuickActionInput): ShellQuickAction[] {
  const rows: ShellQuickAction[] = input.eventLive
    ? [
        { id: "brief", label: "Pre-match brief", href: "/competition?tab=briefing", icon: "target", tone: "primary" },
        { id: "scout", label: "Scout a match", href: "/competition?tab=scouting", icon: "scout" },
        { id: "checklist", label: "Pit checklist", href: "/competition?tab=match-checklist", icon: "clipboard" },
        { id: "notes", label: "Log a note", href: "/competition?tab=match-notes-timeline", icon: "pin" },
        { id: "chat", label: "Team chat", href: "/team?tab=messages", icon: "chat", badge: input.unreadMessages },
      ]
    : [
        { id: "my-day", label: "My Day", href: "/competition?tab=my-day", icon: "calendar", tone: "primary" },
        { id: "calendar", label: "Calendar", href: "/team?tab=calendar", icon: "calendar" },
        { id: "chat", label: "Team chat", href: "/team?tab=messages", icon: "chat", badge: input.unreadMessages },
        { id: "work", label: "My work", href: "/team?tab=todos", icon: "clipboard" },
        { id: "hours", label: "Clock in", href: "/hours", icon: "users" },
      ];
  return rows.filter((row) => input.isAllowed(row.href)).slice(0, 5);
}

/**
 * The sidebar (unlike the drawer) keeps every hub's chips on screen, so a quick
 * action pointing at a chip that is already visible renders the same
 * destination twice in one panel — "Calendar" and "My work" sat a few
 * centimetres above the Team chips of the same name.
 *
 * Drop those. An action that can carry a badge stays either way: an unread
 * count is information the chip cannot show, and keying off the declared field
 * rather than its value keeps the row from appearing and disappearing as
 * messages arrive.
 */
export function dedupeSidebarQuickActions(
  actions: readonly ShellQuickAction[],
  hubs: readonly ShellHub[],
): ShellQuickAction[] {
  const chipHrefs = new Set<string>();
  for (const hub of hubs) {
    for (const tab of hub.tabs) chipHrefs.add(tab.href);
  }
  return actions.filter((action) => "badge" in action || !chipHrefs.has(action.href));
}

/**
 * Recent destinations resolved to labels through the command catalog, so the
 * drawer can show "Alliance desk · Competition › Strategy" instead of a URL.
 * Unknown hrefs are dropped rather than rendered raw.
 */
export function resolveShellRecents(
  hrefs: readonly string[],
  isAllowed: (href: string) => boolean,
  limit = 5,
): ShellRecent[] {
  const catalog = commandCatalog();
  const byHref = new Map<string, { label: string; context: string }>();
  for (const entry of catalog) {
    byHref.set(stripOrg(entry.href), { label: entry.label, context: entry.context });
  }
  const out: ShellRecent[] = [];
  const seen = new Set<string>();
  for (const raw of hrefs) {
    const href = stripOrg(raw);
    if (seen.has(href)) continue;
    const hit = byHref.get(href);
    if (!hit || !isAllowed(href)) continue;
    seen.add(href);
    out.push({ href, label: hit.label, context: hit.context });
    if (out.length >= limit) break;
  }
  return out;
}

/** Drop `orgId=` so a recent recorded on one team still resolves on another. */
export function stripOrg(href: string): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const q = withoutHash.indexOf("?");
  if (q < 0) return withoutHash + hash;
  const params = new URLSearchParams(withoutHash.slice(q + 1));
  params.delete("orgId");
  const query = params.toString();
  return `${withoutHash.slice(0, q)}${query ? `?${query}` : ""}${hash}`;
}

const SIDEBAR_STORAGE_KEY = "vantage-sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Preference only — never a failure.
  }
}

/** Laptop-and-up gets the persistent sidebar; phones and tablets keep the drawer. */
export const SIDEBAR_MEDIA_QUERY = "(min-width: 1180px)";
