/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Drawer IA is almost flat: one hub link per pillar. Deep tools live as
 * hub tabs / More tools; Cmd+K searches the full catalog.
 *
 * Pillars: Competition · Team · Logistics · Business · Media · Build · AI
 * (+ Home). Settings live in the drawer footer only.
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

const TONE = { tone: "#1457d9", toneBg: "#e8eefc" } as const;

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
 * Drawer IA — one link per pillar. Deep tools are hub tabs + Cmd+K.
 * Settings / Account / App manual live in the drawer footer, not here.
 */
export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = [
  {
    label: "Home",
    ...TONE,
    icon: "home",
    items: [{ href: "/dashboard", label: "Home", icon: "home" }],
  },
  {
    label: "Competition",
    ...TONE,
    icon: "swords",
    items: [{ href: "/competition", label: "Competition", icon: "swords" }],
  },
  {
    label: "Team",
    ...TONE,
    icon: "users",
    items: [{ href: "/team", label: "Team", icon: "users" }],
  },
  {
    label: "Logistics",
    ...TONE,
    icon: "pin",
    items: [{ href: "/logistics", label: "Logistics", icon: "pin" }],
  },
  {
    label: "Business",
    ...TONE,
    icon: "clipboard",
    items: [{ href: "/business", label: "Business", icon: "clipboard" }],
  },
  {
    label: "Media",
    ...TONE,
    icon: "camera",
    items: [{ href: "/media", label: "Media", icon: "camera" }],
  },
  {
    label: "Build",
    ...TONE,
    icon: "cube",
    items: [{ href: "/build", label: "Build", icon: "cube" }],
  },
  {
    label: "AI",
    ...TONE,
    icon: "bolt",
    items: [{ href: "/ai", label: "AI", icon: "bolt" }],
  },
];

/** Standalone logistics tools — Cmd+K / breadcrumbs only (not drawer leaves). */
export const LOGISTICS_DEEP_LINKS: ProductNavItem[] = [
  { href: "/packing", label: "Packing", icon: "grid" },
  { href: "/duties", label: "Duties", icon: "users" },
  { href: "/visit-invites", label: "Visit invites", icon: "users" },
];

/** Quiet chrome destinations — Cmd+K / footer, never drawer accordion dumps. */
export const SETTINGS_DEEP_LINKS: ProductNavItem[] = [
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/workspace", label: "Workspace", icon: "grid" },
  { href: "/account", label: "Account", icon: "users" },
  { href: "/docs", label: "App manual", icon: "clipboard" },
  { href: "/support", label: "Support", icon: "chat" },
  { href: "/security", label: "Security", icon: "gear" },
  { href: "/team/admin", label: "Team admin", icon: "gear" },
  { href: "/team/data", label: "Team data", icon: "stats" },
  { href: "/team/ai-keys", label: "AI keys", icon: "gear" },
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/inventory", label: "Inventory", icon: "grid" },
];

/** Bottom island — glanceable; full IA lives in hubs + Cmd+K. */
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
  { href: "/media", label: "Media", icon: "camera" },
  { href: "/competition?tab=scouting", label: "Scout", icon: "scout" },
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/logistics", label: "Logistics", icon: "pin" },
  { href: "/team?tab=messages", label: "Team chat", icon: "chat" },
];

/**
 * Soft-UI pillars for Search (⌘K) shortcuts — hub roots only.
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
 * Glanceable ops under the pillars — four shortcuts only.
 */
export const MORE_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/competition?tab=my-day", label: "My Day", icon: "calendar" },
  { href: "/competition?tab=forms", label: "Forms", icon: "clipboard" },
  { href: "/competition?tab=match-checklist", label: "Checklist", icon: "clipboard" },
  { href: "/team?tab=messages", label: "Team chat", icon: "chat" },
];

/** @deprecated Prefer hub tabs + Cmd+K — kept for residual imports. */
export const FEATURED_SOFT_UI_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  { href: "/alliance-selection-desk", label: "Alliance desk", icon: "swords" },
  { href: "/season-planning-workspace", label: "Season planning", icon: "calendar" },
  { href: "/team/ai-keys", label: "AI keys", icon: "gear" },
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

function dedupeNavItems(items: ProductNavItem[]): ProductNavItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

/**
 * Full Cmd+K catalog: drawer hubs + every Soft-UI hub tab + logistics/settings deep links.
 * Drawer stays flat; typing unlocks the module list.
 */
export function cmdkNavCatalog(): ProductNavItem[] {
  const items: ProductNavItem[] = [];
  for (const group of PRODUCT_NAV_GROUPS) {
    items.push(...group.items.filter((item) => item.state !== "planned"));
  }
  for (const hub of PRODUCT_HUBS) {
    const group = PRODUCT_NAV_GROUPS.find((entry) => entry.label === hub.label);
    const icon = group?.icon ?? "grid";
    for (const tab of hub.tabs) {
      items.push({
        href: `${hub.href}?tab=${tab.id}`,
        label: tab.label,
        icon,
      });
    }
  }
  items.push(...LOGISTICS_DEEP_LINKS, ...SETTINGS_DEEP_LINKS, ...FEATURED_SOFT_UI_LINKS);
  return dedupeNavItems(items);
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
      const score =
        hrefPath.length +
        (exact ? 1_000 : 0) +
        (item.href.includes("?") ? -50 : 0) +
        (exact && !item.href.includes("?") ? 100 : 0);
      if (!best || score > best.score) best = { group, item, score };
    }
  }

  // Soft-UI hub tabs / legacy redirects — drawer no longer lists these leaves.
  if (!best || best.score < 1_000) {
    let hubBest: { group: ProductNavGroup; item: ProductNavItem; score: number } | null = null;
    for (const hub of PRODUCT_HUBS) {
      const group = PRODUCT_NAV_GROUPS.find((entry) => entry.label === hub.label);
      if (!group) continue;
      for (const tab of hub.tabs) {
        const legacy = tab.legacyHref;
        if (!legacy) continue;
        const exact = path === legacy;
        const nested = path.startsWith(`${legacy}/`);
        if (!exact && !nested) continue;
        const score = legacy.length + (exact ? 1_000 : 0);
        if (!hubBest || score > hubBest.score) {
          hubBest = {
            group,
            item: {
              href: `${hub.href}?tab=${tab.id}`,
              label: tab.label,
              icon: group.icon,
            },
            score,
          };
        }
      }
    }
    if (hubBest) return { group: hubBest.group, item: hubBest.item };
  }

  // Logistics / settings deep links for breadcrumbs when not in the flat drawer.
  if (!best || best.score < 1_000) {
    const logisticsGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Logistics");
    if (logisticsGroup) {
      for (const item of LOGISTICS_DEEP_LINKS) {
        const hrefPath = navPathOnly(item.href);
        if (path === hrefPath || path.startsWith(`${hrefPath}/`)) {
          return { group: logisticsGroup, item };
        }
      }
    }
    const homeGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Home");
    const settingsPseudo: ProductNavGroup = {
      label: "Settings",
      ...TONE,
      icon: "gear",
      items: SETTINGS_DEEP_LINKS,
    };
    for (const item of SETTINGS_DEEP_LINKS) {
      const hrefPath = navPathOnly(item.href);
      if (path === hrefPath || (hrefPath !== "/" && path.startsWith(`${hrefPath}/`))) {
        if (item.href === "/notifications" || item.href === "/workspace") {
          return { group: homeGroup ?? settingsPseudo, item };
        }
        if (item.href.startsWith("/team/")) {
          const teamGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Team");
          if (teamGroup) return { group: teamGroup, item };
        }
        if (item.href === "/inventory") {
          const buildGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Build");
          if (buildGroup) return { group: buildGroup, item };
        }
        if (item.href === "/schedule") {
          const competitionGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Competition");
          if (competitionGroup) return { group: competitionGroup, item };
        }
        return { group: settingsPseudo, item };
      }
    }
  }

  return best ? { group: best.group, item: best.item } : null;
}

export function breadcrumbForPath(pathname: string): string {
  const match = findNavMatch(pathname);
  if (!match) return "Vantage";
  if (match.item.label === match.group.label) return match.group.label;
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
