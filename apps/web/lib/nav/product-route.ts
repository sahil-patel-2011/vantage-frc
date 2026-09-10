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
 * Product chrome (drawer, island, appearance runtime) — not marketing, not
 * sign-in, not pit TV, not a public form or sponsor storefront.
 */
export function pathnameUsesAppShell(pathname: string): boolean {
  if (APP_SHELL_EXEMPT_EXACT.has(pathname)) return false;
  if (pathname.startsWith("/display/kiosk")) return false;
  if (pathname.startsWith("/display/pit")) return false;
  if (pathname.startsWith("/showcase/present")) return false;
  // Public sponsor storefront stays shell-free; /support tickets use the app chrome.
  if (/^\/support\/[^/]+/.test(pathname)) return false;
  // Token-scoped public form intake. The person answering has no account.
  if (/^\/f\/[a-f0-9]{32}$/.test(pathname)) return false;
  return true;
}
