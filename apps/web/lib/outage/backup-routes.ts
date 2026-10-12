/**
 * What answers in backup mode (VANTAGE_BACKUP_MODE, packages/db/src/backup-mode.ts), decided in
 * the proxy before any session lookup.
 *
 * With no database there is no sign-in, no team and nothing private to show, so the line is
 * simple: the public site and the few endpoints that never read the database keep working, an
 * API call that would need it gets one clear 503, and any other page goes to the sign-in page,
 * which explains backup mode and links the team's Google Sheets copy. Nothing waits on a
 * connection that will never come, and no page can crash on one.
 */

export type BackupRoute = "pass" | "api_unavailable" | "notice";

/** Pages that render without a database: the marketing site, legal pages and the notice itself. */
const PAGES = new Set([
  "/",
  "/features",
  "/features/cad",
  "/features/strategy",
  "/features/code",
  "/workflow",
  "/desktop",
  "/for-teams",
  "/pricing",
  "/privacy",
  "/terms",
  "/signin",
  "/sign-in",
  "/access-unavailable",
  "/offline",
  "/opengraph-image",
  "/twitter-image",
  // Static downloads fetched by scripts, which can't follow a redirect to a page.
  "/team-setup.ps1",
  "/vantage-ai-bridge.mjs",
]);

/**
 * Endpoints that never read the database: the uptime check, the public status flag and the
 * outage console (outage store only), the waitlist (emailed to the owner in backup mode) and the
 * desktop download feed (GitHub).
 */
const API_PREFIXES = ["/api/health", "/api/status", "/api/waitlist", "/api/desktop/release"];

/** The outage console works from its signed link and the outage store, never the database. */
const PAGE_PREFIXES = ["/status/outage"];

const STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

function underPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function backupModeRoute(pathname: string): BackupRoute {
  if (pathname.startsWith("/_next/") || STATIC_FILE.test(pathname)) return "pass";
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return underPrefix(pathname, API_PREFIXES) ? "pass" : "api_unavailable";
  }
  if (PAGES.has(pathname) || underPrefix(pathname, PAGE_PREFIXES)) return "pass";
  return "notice";
}
