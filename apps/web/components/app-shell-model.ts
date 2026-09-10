import type { ClientHubAccessRow } from "../lib/nav/hub-access-filter";
import {
  ORG_EXEMPT_HREFS,
  navTitleForPath,
  withOrgHref,
  withSelectedOrgHref,
  type ProductNavGroup,
} from "../lib/nav/product-nav";
import type { CommandHit } from "../lib/nav/command-search";

export type SearchHit = {
  title: string;
  subtitle?: string | null;
  href: string;
  sourceLabel?: string;
};

export type MembershipOption = {
  orgId: string;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

export type Me = {
  name?: string | null;
  firstName?: string | null;
  displayName?: string | null;
  email?: string | null;
  image?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  planCode?: string | null;
  paidOrg?: boolean;
  memberships?: MembershipOption[];
  platformAdmin?: boolean;
  unreadNotificationCount?: number;
  unreadMessageCount?: number;
  hubAccess?: ClientHubAccessRow[] | null;
  sponsorsAllowed?: boolean | null;
  schoolFunded?: boolean | null;
  outsideGrants?: boolean | null;
  teamAffiliation?: string | null;
};

export type NavResultRow =
  | { kind: "command"; href: string; hit: CommandHit }
  | { kind: "data"; href: string; hit: SearchHit };

const HUB_ROOT_PATHS = new Set([
  "/",
  "/dashboard",
  "/competition",
  "/team",
  "/business",
  "/media",
  "/build",
  "/ai",
  "/logistics",
]);

const BRAND_LIKE_NAME = /^(vantage|team\s*\d+)/i;

export function formatMembershipLabel(row: MembershipOption): string {
  const team =
    row.teamNumber != null && Number.isFinite(row.teamNumber) ? `Team ${row.teamNumber}` : null;
  const name = row.orgName?.trim() || null;
  const parts = [team, name].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Your team";
}

export function formatRolePlanCue(role?: string | null, planCode?: string | null, paidOrg?: boolean): string {
  const roleLabel = role?.trim() ? role.trim() : null;
  const planLabel = planCode?.trim()
    ? paidOrg
      ? planCode.trim()
      : `${planCode.trim()} plan`
    : null;
  if (roleLabel && planLabel) return `${roleLabel} · ${planLabel}`;
  if (roleLabel) return roleLabel;
  if (planLabel) return planLabel;
  return "Your team";
}

export function islandTabIsActive(pathname: string, search: string, tabHref: string): boolean {
  const [pathPart, queryPart] = tabHref.split("?");
  const path = pathPart || tabHref;
  const calendarAlias =
    path === "/team/calendar" && (pathname === "/calendar" || pathname.startsWith("/calendar/"));
  if (pathname !== path && !(path !== "/" && pathname.startsWith(`${path}/`)) && !calendarAlias) {
    if (tabHref === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return false;
  }
  if (!queryPart) {
    if (tabHref === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    if (path === "/team/calendar") return pathname.startsWith("/team/calendar") || pathname === "/calendar" || pathname.startsWith("/calendar/");
    return pathname === path || pathname.startsWith(`${path}/`);
  }
  const want = new URLSearchParams(queryPart.split("#")[0] || "");
  const have = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [key, value] of want.entries()) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

export function activeIslandHref(
  pathname: string,
  search: string,
  tabs: Array<{ href: string }>,
): string | undefined {
  const queryMatch = tabs.find((tab) => tab.href.includes("?") && islandTabIsActive(pathname, search, tab.href));
  return queryMatch?.href ?? tabs.find((tab) => islandTabIsActive(pathname, search, tab.href))?.href;
}

export function accountLabelFor(me: Me): string | null {
  return me.displayName?.trim() || me.name?.trim() || me.firstName?.trim() || me.email?.trim() || null;
}

export function accountInitialFor(me: Me): string {
  const initialSource =
    me.firstName?.trim() || me.displayName?.trim() || me.name?.trim() || me.email?.trim() || null;
  if (!initialSource) return "?";
  if (BRAND_LIKE_NAME.test(initialSource) && me.email?.trim()) {
    return me.email.trim()[0]!.toUpperCase();
  }
  if (BRAND_LIKE_NAME.test(initialSource)) return "?";
  return initialSource[0]!.toUpperCase();
}

export function isHubRootPath(pathname: string): boolean {
  return HUB_ROOT_PATHS.has(pathname);
}

export function showBackForPath(pathname: string): boolean {
  if (isHubRootPath(pathname)) return false;
  return (
    pathname.startsWith("/account") ||
    pathname.startsWith("/team/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/security") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/help") ||
    pathname === "/support"
  );
}

export function backHrefForPath(pathname: string, orgId: string | null): string {
  if (pathname.startsWith("/account")) return "/dashboard";
  if (pathname.startsWith("/security")) return "/account";
  if (pathname === "/support") return "/docs";
  if (pathname.startsWith("/docs/") || pathname === "/docs" || pathname.startsWith("/help/") || pathname === "/help") {
    return pathname === "/docs" || pathname === "/help" ? "/dashboard" : "/docs";
  }
  if (pathname.startsWith("/notifications")) return "/dashboard";
  if (pathname.startsWith("/admin/") || pathname === "/admin") {
    return pathname === "/admin" ? "/dashboard" : "/admin";
  }
  if (pathname.startsWith("/team/")) {
    return withOrgHref("/team", orgId);
  }
  return "/dashboard";
}

export function shellTitleForPath(pathname: string): string | null {
  const fromNav = navTitleForPath(pathname);
  if (fromNav) return fromNav;
  if (pathname.startsWith("/account")) return "Account";
  if (pathname.startsWith("/notifications")) return "Notifications";
  if (pathname.startsWith("/admin")) return "Admin";
  if (pathname.startsWith("/docs") || pathname.startsWith("/help")) return "App manual";
  if (pathname === "/support") return "Support";
  if (pathname.startsWith("/security")) return "Security";
  return null;
}

export function orgLabelFor(me: Me, orgId: string): string {
  if (me.teamNumber != null) {
    return `Team ${me.teamNumber}${me.orgName ? ` · ${me.orgName}` : ""}`;
  }
  return me.orgName ?? (orgId ? "This team" : "No team selected");
}

export function switchWorkspaceHrefFor(pathname: string, pathSearch: string, nextOrgId: string): string {
  const pathOnly = pathname.split("?")[0] || pathname;
  if (ORG_EXEMPT_HREFS.has(pathOnly) || pathOnly.startsWith("/admin")) {
    return withOrgHref("/workspace", nextOrgId);
  }
  return withSelectedOrgHref(`${pathname}${pathSearch || ""}` || "/competition", nextOrgId);
}

export function filterVisibleNavGroups(
  groups: ProductNavGroup[],
  navHrefAllowed: (href: string) => boolean,
): ProductNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => navHrefAllowed(item.href)),
    }))
    .filter((group) => group.items.length > 0);
}

export function navResultRows(commandHits: CommandHit[], searchHits: SearchHit[]): NavResultRow[] {
  return [
    ...commandHits.map((hit) => ({ kind: "command" as const, href: hit.href, hit })),
    ...searchHits.map((hit) => ({ kind: "data" as const, href: hit.href, hit })),
  ];
}
