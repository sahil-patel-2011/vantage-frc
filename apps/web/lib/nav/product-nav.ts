/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Pillars: Competition · Team · Logistics · Business · Media · Build · AI
 * (+ Home entry + Settings). See docs/FEATURE_MAP.md.
 */

import { PRODUCT_HUBS } from "./hubs";

export type NavItemState = "setup" | "planned";

export type ProductNavItem = {
  href: string;
  label: string;
  icon: ProductNavIcon;
  state?: NavItemState;
};

export type ProductNavGroup = {
  label: string;
  tone: string;
  toneBg: string;
  icon: ProductNavIcon;
  items: ProductNavItem[];
};

export type ProductNavIcon =
  | "menu"
  | "search"
  | "bell"
  | "x"
  | "home"
  | "swords"
  | "scout"
  | "stats"
  | "chevron"
  | "chat"
  | "target"
  | "calendar"
  | "clipboard"
  | "camera"
  | "users"
  | "bolt"
  | "cube"
  | "code"
  | "display"
  | "gear"
  | "grid"
  | "pin"
  | "back";

const TONE = { tone: "#1f4fd6", toneBg: "#e8eefc" } as const;

/** Routes that never append ?orgId= (account / platform chrome). */
export const ORG_EXEMPT_HREFS = new Set([
  "/dashboard",
  "/account",
  "/security",
  "/admin",
  "/notifications",
  "/docs",
  "/help",
  "/support",
  "/signin",
  "/sign-in",
]);

/**
 * Drawer IA — short lists only (≈3–6 per pillar). Deep tools live as hub tabs.
 * Cmd+K / hub More tools still reach the full catalog via PRODUCT_HUBS.
 */
export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = [
  {
    label: "Home",
    ...TONE,
    icon: "home",
    items: [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/workspace", label: "Workspace", icon: "grid" },
      { href: "/notifications", label: "Notifications", icon: "bell" },
    ],
  },
  {
    label: "Competition",
    ...TONE,
    icon: "swords",
    items: [
      { href: "/competition", label: "Competition hub", icon: "swords" },
      { href: "/competition?tab=command", label: "Command", icon: "target" },
      { href: "/competition?tab=scouting", label: "Scouting", icon: "scout" },
      { href: "/competition?tab=strategy", label: "Strategy", icon: "stats" },
      { href: "/schedule", label: "Schedule", icon: "calendar" },
      { href: "/alliance-selection-desk", label: "Alliance desk", icon: "swords" },
    ],
  },
  {
    label: "Team",
    ...TONE,
    icon: "users",
    items: [
      { href: "/team", label: "Team hub", icon: "users" },
      { href: "/team?tab=calendar", label: "Calendar", icon: "calendar" },
      { href: "/team?tab=messages", label: "Messages", icon: "chat" },
      { href: "/team?tab=todos", label: "Todos", icon: "clipboard" },
      { href: "/season-planning-workspace", label: "Season planning", icon: "calendar" },
      { href: "/team/data", label: "Team data", icon: "stats" },
    ],
  },
  {
    label: "Logistics",
    ...TONE,
    icon: "pin",
    items: [
      { href: "/logistics", label: "Logistics", icon: "pin" },
      { href: "/packing", label: "Packing", icon: "grid" },
      { href: "/duties", label: "Duties", icon: "users" },
      { href: "/visit-invites", label: "Visit invites", icon: "users" },
    ],
  },
  {
    label: "Business",
    ...TONE,
    icon: "clipboard",
    items: [
      { href: "/business", label: "Business hub", icon: "clipboard" },
      { href: "/business?tab=budget", label: "Budget", icon: "stats" },
      { href: "/business?tab=sponsors", label: "Sponsors", icon: "users" },
      { href: "/business?tab=grants", label: "Grants", icon: "clipboard" },
      { href: "/business?tab=orders", label: "Orders", icon: "clipboard" },
    ],
  },
  {
    label: "Media",
    ...TONE,
    icon: "camera",
    items: [
      { href: "/media", label: "Media hub", icon: "camera" },
      { href: "/media?tab=calendar", label: "Calendar", icon: "calendar" },
      { href: "/media?tab=drafts", label: "Drafts", icon: "clipboard" },
      { href: "/media?tab=kit", label: "Kit", icon: "clipboard" },
    ],
  },
  {
    label: "Build",
    ...TONE,
    icon: "cube",
    items: [
      { href: "/build", label: "Build hub", icon: "cube" },
      { href: "/build?tab=kickoff", label: "Kickoff", icon: "bolt" },
      { href: "/build?tab=cad", label: "CAD", icon: "cube", state: "setup" },
      { href: "/build?tab=code", label: "Code", icon: "code" },
      { href: "/inventory", label: "Inventory", icon: "grid" },
    ],
  },
  {
    label: "AI",
    ...TONE,
    icon: "bolt",
    items: [
      { href: "/ai", label: "AI hub", icon: "bolt" },
      { href: "/ai?tab=chat", label: "Chat", icon: "chat" },
      { href: "/ai?tab=writer", label: "Writer", icon: "chat" },
      { href: "/team/ai-keys", label: "API keys", icon: "gear" },
      { href: "/ai?tab=budgets", label: "Budgets", icon: "stats" },
    ],
  },
  {
    label: "Settings",
    ...TONE,
    icon: "gear",
    items: [
      { href: "/account", label: "Account", icon: "users" },
      { href: "/docs", label: "App manual", icon: "clipboard" },
      { href: "/support", label: "Support", icon: "chat" },
      { href: "/security", label: "Security", icon: "gear" },
      { href: "/team/admin", label: "Team admin", icon: "gear" },
    ],
  },
];

/** Bottom island — glanceable; full IA lives in the drawer / More sheet. */
export type IslandTabDefinition = { href: string; label: string; icon: ProductNavIcon };

export const PRIMARY_TABS: IslandTabDefinition[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/competition", label: "Compete", icon: "swords" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/business", label: "Business", icon: "clipboard" },
];

/** Allowlisted destinations for the four personal island slots. */
export const ISLAND_TAB_CATALOG: IslandTabDefinition[] = [
  ...PRIMARY_TABS,
  { href: "/build", label: "Build", icon: "cube" },
  { href: "/ai", label: "AI", icon: "bolt" },
  { href: "/media", label: "Media", icon: "clipboard" },
  { href: "/competition?tab=scouting", label: "Scout", icon: "scout" },
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/team?tab=messages", label: "Messages", icon: "chat" },
];

/**
 * Soft-UI pillars for the More sheet / drawer — readable hierarchy first.
 * Competition · Team · Logistics · Business · Media · Build · AI
 */
export const PILLAR_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition", label: "Competition", icon: "swords" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/business", label: "Business", icon: "clipboard" },
  { href: "/media", label: "Media", icon: "camera" },
  { href: "/build", label: "Build", icon: "cube" },
  { href: "/ai", label: "AI", icon: "bolt" },
];

/**
 * Glanceable ops under the pillars — four shortcuts only (full IA lives in the drawer).
 */
export const MORE_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/competition?tab=forms", label: "Forms", icon: "clipboard" },
  { href: "/competition?tab=match-checklist", label: "Checklist", icon: "clipboard" },
  { href: "/team?tab=messages", label: "Messages", icon: "chat" },
];

/** @deprecated Prefer MORE_SHEET_LINKS — kept for any residual imports. */
export const FEATURED_SOFT_UI_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/alliance-selection-desk", label: "Alliance desk", icon: "swords" },
  { href: "/season-planning-workspace", label: "Season planning", icon: "calendar" },
  { href: "/team/ai-keys", label: "AI API keys", icon: "gear" },
  { href: "/writer", label: "Writer", icon: "bolt" },
];

export function withOrgHref(href: string, orgId: string | null | undefined): string {
  if (!orgId) return href;
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const pathOnly = withoutHash.split("?")[0] ?? withoutHash;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) return href;
  if (withoutHash.includes("orgId=")) return href;
  const join = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${join}orgId=${encodeURIComponent(orgId)}${hash}`;
}

/**
 * Keep the current path/query (tabs, filters) but force a selected workspace orgId.
 * Used by the Soft-UI account menu when switching team workspaces.
 */
export function withSelectedOrgHref(href: string, orgId: string): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const pathOnly = withoutHash.split("?")[0] ?? withoutHash;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) {
    return `${pathOnly}${hash}`;
  }
  const query = withoutHash.includes("?") ? withoutHash.slice(withoutHash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  params.set("orgId", orgId);
  return `${pathOnly}?${params.toString()}${hash}`;
}

/** Path portion of a nav href (hubs use ?tab=). */
function navPathOnly(href: string): string {
  return href.split("?")[0] || href;
}

/**
 * Longest matching nav href wins (so /team/security beats /team).
 * Also resolves Soft-UI hub legacy paths (/command → Competition / Command)
 * via PRODUCT_HUBS.legacyHref when the live href is a ?tab= destination.
 */
export function findNavMatch(
  pathname: string,
): { group: ProductNavGroup; item: ProductNavItem } | null {
  const path = pathname.split("?")[0] || "/";
  let best: { group: ProductNavGroup; item: ProductNavItem; score: number } | null = null;

  for (const group of PRODUCT_NAV_GROUPS) {
    for (const item of group.items) {
      if (item.state === "planned") continue;
      const hrefPath = navPathOnly(item.href);
      const exact = path === hrefPath;
      const nested = hrefPath !== "/" && path.startsWith(`${hrefPath}/`);
      if (!exact && !nested) continue;
      // Prefer specific Team routes over the hub root for nested paths.
      if (hrefPath === "/team" && nested) continue;
      if (exact && hrefPath === "/team" && group.label === "Settings") continue;
      // Prefer concrete hub tabs over bare hub roots when path is exactly the hub.
      const score =
        hrefPath.length +
        (exact ? 1_000 : 0) +
        (item.href.includes("?") ? -50 : 0) +
        (exact && !item.href.includes("?") ? 100 : 0);
      if (!best || score > best.score) best = { group, item, score };
    }
  }

  // Legacy Soft-UI redirects: /scouting, /kickoff, /messages, …
  if (!best || best.score < 1_000) {
    for (const hub of PRODUCT_HUBS) {
      for (const tab of hub.tabs) {
        if (!tab.legacyHref || path !== tab.legacyHref) continue;
        const group = PRODUCT_NAV_GROUPS.find((entry) => entry.label === hub.label);
        const item = group?.items.find(
          (entry) => entry.href === `${hub.href}?tab=${tab.id}` || navPathOnly(entry.href) === tab.legacyHref,
        );
        if (group && item) {
          return { group, item };
        }
        if (group) {
          return {
            group,
            item: {
              href: `${hub.href}?tab=${tab.id}`,
              label: tab.label,
              icon: group.icon,
            },
          };
        }
      }
    }
  }

  return best ? { group: best.group, item: best.item } : null;
}

export function breadcrumbForPath(pathname: string): string {
  const match = findNavMatch(pathname);
  if (!match) return "Vantage";
  return `${match.group.label} / ${match.item.label}`;
}

export function navTitleForPath(pathname: string): string | null {
  const match = findNavMatch(pathname);
  return match?.item.label ?? null;
}

export function flattenNavItems(includePlanned = false): ProductNavItem[] {
  return PRODUCT_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => includePlanned || item.state !== "planned"),
  );
}
