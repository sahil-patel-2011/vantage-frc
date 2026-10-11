/**
 * Which routes mount AppShell vs stay shell-free.
 *
 * Keep this in one place: ThemeProvider used to inline the list, and product
 * chrome CSS follows the same split (AppShell + a few public shells).
 */

const APP_SHELL_EXEMPT_EXACT = new Set([
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
  "/offline",
]);

/**
 * The way in: signing in, an invite, joining by code, onboarding, and the "can't open this"
 * page. Some keep a frame of product chrome, but the person there is signed out or has not
 * finished their profile, so the signed-in APIs (/api/me, /api/branding,
 * /api/navigation/preferences, /api/theme) answer 401/403. Nothing on these pages calls them.
 */
const ENTRY_SCREENS = new Set(["/signin", "/sign-in", "/invite", "/join-team", "/onboarding", "/access-unavailable"]);

export function pathnameIsEntryScreen(pathname: string): boolean {
  return ENTRY_SCREENS.has(pathname.replace(/\/+$/, "") || "/");
}

/**
 * Product chrome (drawer, island, appearance runtime) — not marketing, not
 * sign-in, not pit TV, not a public form or sponsor storefront.
 */
export function pathnameUsesAppShell(pathname: string): boolean {
  if (APP_SHELL_EXEMPT_EXACT.has(pathname)) return false;
  // The Scouting product brings its own frame (app/scout/layout.tsx).
  if (pathname === "/scout" || pathname.startsWith("/scout/")) return false;
  if (pathname.startsWith("/display/kiosk")) return false;
  if (pathname.startsWith("/display/pit")) return false;
  // The event board is a TV too: full screen, no menu.
  if (pathname.startsWith("/display/stage")) return false;
  if (pathname.startsWith("/showcase/present")) return false;
  // Public sponsor storefront stays shell-free; /support tickets use the app chrome.
  if (/^\/support\/[^/]+/.test(pathname)) return false;
  // Token-scoped public form intake. The person answering has no account.
  if (/^\/f\/[a-f0-9]{32}$/.test(pathname)) return false;
  return true;
}
