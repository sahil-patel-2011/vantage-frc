import { PRODUCT_HUBS } from "./hubs";

/**
 * Whether a link goes to the page you are already on.
 *
 * Search's top suggestion on Event day was "Event day": choosing it reloaded the page and looked
 * broken. Two addresses are the same destination when they share a path and a hub tab — a
 * hub's root with no tab means its default tab — whatever else (orgId, filters) the query has.
 */
export function isCurrentDestination(href: string, current: { pathname: string; search: string }): boolean {
  let target: URL;
  try {
    target = new URL(href, "https://vantage.local");
  } catch {
    return false;
  }
  if (target.pathname !== current.pathname) return false;
  const hub = PRODUCT_HUBS.find((entry) => entry.href === current.pathname);
  const tabOf = (search: string) => new URLSearchParams(search).get("tab") ?? hub?.defaultTab ?? null;
  return tabOf(target.search) === tabOf(current.search);
}
