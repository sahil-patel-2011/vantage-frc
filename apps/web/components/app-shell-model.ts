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

/**
 * Does a team's own name tell you anything the number does not?
 *
 * Most teams name their workspace after their number — "Team 6925", or just
 * "6925". Sticking the number in front of that produces "Team 6925 · Team 6925",
 * which reads as a rendering fault rather than as a name, and it was on the top
 * bar of every single page.
 *
 * Strips a leading "team", punctuation and spacing, then asks whether what is
 * left is just the number again. "Team 6925 Robotics" survives that, because
 * "Robotics" is a real part of the name.
 */
export function orgNameAddsDetail(
  teamNumber: number | null | undefined,
  orgName: string | null | undefined,
): boolean {
  const name = (orgName ?? "").trim();
  if (!name) return false;
  if (teamNumber == null) return true;
  const reduced = name
    .toLowerCase()
    .replace(/^team\b/, "")
    .replace(/[^a-z0-9]+/g, "");
  return reduced !== String(teamNumber) && reduced.length > 0;
}

/** The one label for a team: its number, plus a real name when it has one. */
export function teamLabelFor(
  teamNumber: number | null | undefined,
  orgName: string | null | undefined,
): string | null {
  if (teamNumber != null) {
    return orgNameAddsDetail(teamNumber, orgName)
      ? `Team ${teamNumber} · ${(orgName ?? "").trim()}`
      : `Team ${teamNumber}`;
  }
  const name = (orgName ?? "").trim();
  return name || null;
}

export function orgLabelFor(me: Me, orgId: string): string {
  return teamLabelFor(me.teamNumber, me.orgName) ?? (orgId ? "This team" : "No team selected");
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
