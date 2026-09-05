/**
 * Product navigation — single source of truth for the app-shell drawer,
 * command palette, and breadcrumb labels.
 *
 * Drawer IA is almost flat: Home plus one link per workspace. Deep tools live
 * as hub tabs / More tools; Cmd+K searches the full catalog.
 *
 * Workspaces come from PRODUCT_WORKSPACES (Scout · Compete · Build · Run
 * season). Settings live in the drawer footer only.
 */

import {
  PRODUCT_HUBS,
  PRODUCT_WORKSPACES,
  workspaceForHubTab,
  type ProductWorkspaceId,
} from "./hubs";

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
 * Drawer IA — one link per product workspace. Deep tools are hub tabs + Cmd+K.
 * Settings / Account / App manual live in the drawer footer, not here.
 */
const WORKSPACE_ICONS: Record<ProductWorkspaceId, ProductNavIcon> = {
  scout: "scout",
  compete: "swords",
  build: "cube",
  "run-season": "calendar",
};

export const PRODUCT_NAV_GROUPS: ProductNavGroup[] = PRODUCT_WORKSPACES.map((workspace) => {
  const icon = WORKSPACE_ICONS[workspace.id];
  return {
    label: workspace.label,
    ...TONE,
    icon,
    items: [{ href: workspace.href, label: workspace.label, icon }],
  };
});

function groupForHubTab(hubId: Parameters<typeof workspaceForHubTab>[0], tabId: string) {
  const workspace = workspaceForHubTab(hubId, tabId);
  return workspace
    ? PRODUCT_NAV_GROUPS.find((group) => group.label === workspace.label)
    : undefined;
}

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

/** Four customizable bottom-island workspace slots. */
export type IslandTabDefinition = { href: string; label: string; icon: ProductNavIcon };

export const PRIMARY_TABS: IslandTabDefinition[] = [
  ...PRODUCT_WORKSPACES.map((workspace) => ({
    href: workspace.href,
    label: workspace.label,
    icon: WORKSPACE_ICONS[workspace.id],
  })),
];

/**
 * Product workspaces for Search (⌘K) shortcuts.
 */
export const PILLAR_SHEET_LINKS: Array<{ href: string; label: string; icon: ProductNavIcon }> = [
  ...PRIMARY_TABS,
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

/**
 * Allowlisted destinations for the four personal island slots. The stock four
 * are the workspaces; the rest are places a member can live in all weekend, so
 * a scout can trade Build for Forms. Without them "customize" could only ever
 * reorder the same four apps.
 */
export const ISLAND_TAB_CATALOG: IslandTabDefinition[] = [
  ...PRIMARY_TABS,
  { href: "/dashboard", label: "Home", icon: "home" },
  ...MORE_SHEET_LINKS,
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
    for (const tab of hub.tabs) {
      const group = groupForHubTab(hub.id, tab.id);
      const icon = group?.icon ?? "grid";
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
      if (item.href.includes("?")) continue;
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
      const rootGroup = groupForHubTab(hub.id, hub.defaultTab);
      if (rootGroup && path === hub.href) {
        const item = rootGroup.items[0];
        if (item) {
          const score = hub.href.length + 1_000;
          if (!hubBest || score > hubBest.score) hubBest = { group: rootGroup, item, score };
        }
      }
      for (const tab of hub.tabs) {
        const group = groupForHubTab(hub.id, tab.id);
        if (!group) continue;
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
    const runSeasonGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Run season");
    if (runSeasonGroup) {
      if (path === "/logistics") {
        const item: ProductNavItem = { href: "/logistics", label: "Logistics", icon: "pin" };
        return { group: runSeasonGroup, item };
      }
      for (const item of LOGISTICS_DEEP_LINKS) {
        const hrefPath = navPathOnly(item.href);
        if (path === hrefPath || path.startsWith(`${hrefPath}/`)) {
          return { group: runSeasonGroup, item };
        }
      }
    }
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
          return { group: settingsPseudo, item };
        }
        if (item.href.startsWith("/team/")) {
          if (runSeasonGroup) return { group: runSeasonGroup, item };
        }
        if (item.href === "/inventory") {
          const buildGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Build");
          if (buildGroup) return { group: buildGroup, item };
        }
        if (item.href === "/schedule") {
          const competeGroup = PRODUCT_NAV_GROUPS.find((entry) => entry.label === "Compete");
          if (competeGroup) return { group: competeGroup, item };
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
