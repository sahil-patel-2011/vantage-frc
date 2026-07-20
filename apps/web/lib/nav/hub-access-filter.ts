/**
 * Soft-UI helpers for hub/tab allowlists and sponsor-funding gates.
 * Pure — safe for client bundles (no @vantage/core).
 */

export const CLIENT_HUB_IDS = [
  "competition",
  "team",
  "business",
  "build",
  "ai",
  "media",
] as const;

export type ClientHubId = (typeof CLIENT_HUB_IDS)[number];

export type ClientHubAccessRow = {
  hubId: ClientHubId;
  allowedTabIds: string[];
};

export const HUB_ACCESS_ALWAYS_PATHS = new Set([
  "/dashboard",
  "/account",
  "/security",
  "/help",
  "/notifications",
  "/support",
  "/start",
  "/workspace",
  "/onboarding",
  "/team/admin",
  "/team/security",
]);

export const SPONSOR_TAB_IDS = new Set([
  "sponsors",
  "sponsorship",
  "placements",
  "sponsor-suite",
  "sponsor-tier-calculator",
  "sponsor-wall",
  "sponsor-renewal-roi",
  "matching-gift-finder",
]);

export function clientHubUnrestricted(rows: ClientHubAccessRow[] | null | undefined): boolean {
  return !rows || rows.length === 0;
}

export function clientCanAccessHub(
  rows: ClientHubAccessRow[] | null | undefined,
  hubId: ClientHubId,
): boolean {
  if (clientHubUnrestricted(rows)) return true;
  return rows!.some((row) => row.hubId === hubId);
}

export function clientCanAccessHubTab(
  rows: ClientHubAccessRow[] | null | undefined,
  hubId: ClientHubId,
  tabId: string,
): boolean {
  if (clientHubUnrestricted(rows)) return true;
  const row = rows!.find((entry) => entry.hubId === hubId);
  if (!row) return false;
  if (!row.allowedTabIds.length) return true;
  return row.allowedTabIds.includes(tabId);
}

export function filterTabsByHubAccess<T extends { id: string }>(
  tabs: T[],
  rows: ClientHubAccessRow[] | null | undefined,
  hubId: ClientHubId,
): T[] {
  if (clientHubUnrestricted(rows)) return tabs;
  if (!clientCanAccessHub(rows, hubId)) return [];
  const row = rows!.find((entry) => entry.hubId === hubId);
  if (!row || !row.allowedTabIds.length) return tabs;
  return tabs.filter((tab) => row.allowedTabIds.includes(tab.id));
}

export function filterSponsorTabs<T extends { id: string }>(
  tabs: T[],
  sponsorsAllowed: boolean | null | undefined,
): T[] {
  if (sponsorsAllowed !== false) return tabs;
  return tabs.filter((tab) => !SPONSOR_TAB_IDS.has(tab.id));
}

/** Map path prefix → hub id for drawer/island filtering. */
export function hubIdForPath(pathname: string): ClientHubId | null {
  if (pathname === "/media" || pathname.startsWith("/media/") || pathname === "/media-kit") {
    return "media";
  }
  if (pathname.startsWith("/competition") || pathname.startsWith("/scouting") || pathname === "/intel") {
    return "competition";
  }
  if (pathname.startsWith("/team") || pathname === "/logistics") return "team";
  if (
    pathname.startsWith("/business") ||
    pathname.startsWith("/fundraisers") ||
    pathname.startsWith("/costs") ||
    pathname.startsWith("/impact") ||
    pathname.startsWith("/orders") ||
    pathname.startsWith("/sponsorship") ||
    pathname.startsWith("/sponsor") ||
    pathname.startsWith("/grant")
  ) {
    return "business";
  }
  if (pathname.startsWith("/build") || pathname.startsWith("/cad") || pathname.startsWith("/kickoff")) {
    return "build";
  }
  if (pathname.startsWith("/ai") || pathname.startsWith("/writer")) return "ai";
  return null;
}

export function pathAllowedByHubAccess(
  href: string,
  rows: ClientHubAccessRow[] | null | undefined,
): boolean {
  if (clientHubUnrestricted(rows)) return true;
  const path = href.split("?")[0] ?? href;
  if (HUB_ACCESS_ALWAYS_PATHS.has(path)) return true;
  const hubId = hubIdForPath(path);
  if (!hubId) return true;
  if (!clientCanAccessHub(rows, hubId)) return false;
  const params = new URLSearchParams(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "");
  const tab = params.get("tab");
  if (!tab) return true;
  return clientCanAccessHubTab(rows, hubId, tab);
}
