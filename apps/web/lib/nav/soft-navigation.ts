import { ORG_EXEMPT_HREFS } from "./product-nav";
import { URL_CHANGE_EVENT } from "./url-change";

/** Notify mounted hub views after Next commits a query-only navigation. */
export function pushAppNavigation(push: (href: string) => void, href: string): void {
  const before = window.location.href;
  const destination = new URL(href, before);
  if (destination.pathname === "/workspace" && destination.searchParams.has("next")) {
    // The picker is the boundary between team documents. Keeping it in the
    // previous team's router tree breaks Back after choosing another team.
    destination.searchParams.delete("orgId");
    window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
    return;
  }
  try {
    push(href);
  } catch {
    window.location.assign(href);
    return;
  }
  let attempts = 0;
  const follow = () => {
    if (window.location.href !== before) window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    else if (++attempts < 60) window.setTimeout(follow, 50);
  };
  window.setTimeout(follow, 0);
}

/**
 * Plain `<a href="/…">` links (many cards, the sidebar, Button as="a") make the browser
 * reload the whole app on every click: the shell flashes, scroll resets and every panel
 * refetches. The app shell listens for those clicks and routes them through the Next
 * router instead, so moving around feels like one app. `next/link` already does this
 * and calls preventDefault, so those clicks are left alone.
 *
 * `softNavigationTarget` decides; it returns the in-app path to push, or null to let the
 * browser handle the click as usual.
 */

export type SoftClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

export type SoftAnchor = {
  href: string;
  target: string;
  hasDownload: boolean;
  rel: string;
  /** `data-full-reload` on the link or an ancestor opts out. */
  fullReload: boolean;
};

const FILE_PATH = /\.[a-z0-9]{2,5}$/i;
/** Routes that must leave the app: API handlers (handoffs, OAuth starts, downloads). */
const HARD_PREFIXES = ["/api/", "/_next/", "/.well-known/"];

export function softNavigationTarget(click: SoftClick, anchor: SoftAnchor, current: URL): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (anchor.fullReload || anchor.hasDownload) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (/\bexternal\b/i.test(anchor.rel)) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (HARD_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (FILE_PATH.test(url.pathname)) return null;
  const explicitTeamPicker = url.pathname === "/workspace" && url.searchParams.has("next");
  // The picker lists memberships across teams. Adding the current scope turns
  // it into a team workspace and prevents the person from choosing another.
  if (explicitTeamPicker) url.searchParams.delete("orgId");
  const currentOrg = current.searchParams.get("orgId");
  const nextOrg = url.searchParams.get("orgId");
  // A workspace change is a document boundary. Many tools resolve their team at
  // mount; reusing them after a query-only navigation can save into the old team.
  if (nextOrg && nextOrg !== currentOrg) return null;
  if (currentOrg && !nextOrg && !explicitTeamPicker && !ORG_EXEMPT_HREFS.has(url.pathname) && !url.pathname.startsWith("/admin")) {
    url.searchParams.set("orgId", currentOrg);
  }
  // Same page, only the #hash differs: the browser scrolls to it without a reload.
  if (url.pathname === current.pathname && url.search === current.search && url.hash) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
