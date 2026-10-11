/**
 * The public site (home, features, pricing, the legal pages) has one palette, and it is light.
 *
 * Someone who picked Dark in Account keeps that choice in a year-long cookie that survives
 * sign-out. The public pages used to follow it while their canvas stayed white, so a signed-out
 * visitor on that device saw pale text on white, the "Sign in" link included. ThemeProvider shows
 * the document light on these paths without touching the saved choice, and the `.marketing-lux`
 * block in system.css keeps the content light before that runs. Sign-in, invites and onboarding
 * are not listed: they have a working dark theme.
 *
 * Every page that renders `.marketing-lux` belongs here (public-theme.test.ts checks it), except
 * not-found, which can be at any address and relies on the CSS alone.
 */
const MARKETING_PAGES = new Set([
  "/",
  "/features",
  "/features/cad",
  "/features/code",
  "/features/strategy",
  "/workflow",
  "/desktop",
  "/for-teams",
  "/pricing",
  "/privacy",
  "/terms",
]);

export function pathnameIsMarketingPage(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MARKETING_PAGES.has(pathname.replace(/\/+$/, "") || "/");
}

export function marketingPagePaths(): string[] {
  return [...MARKETING_PAGES];
}
