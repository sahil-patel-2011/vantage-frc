/**
 * Routes a signed-in person may open after their profile is saved and before
 * a team has approved them. The onboarding "while you wait" links point here.
 * Anything else bounces back to /onboarding?state=pending.
 *
 * Incomplete profiles stay on /onboarding itself — this list is only for
 * people who already finished the form and are waiting on a team.
 */

const EXACT = new Set([
  "/onboarding",
  "/invite",
  "/claim",
  "/docs",
  "/help",
  "/roadmap",
  "/account",
  "/security",
]);

const PREFIXES = [
  "/docs/",
  "/help/",
  "/api/onboarding",
  "/api/invites",
  "/api/organizations/claim",
  "/api/auth",
  "/api/theme",
  "/api/me",
  "/api/account",
  "/api/branding",
  "/api/navigation/preferences",
  "/api/security/mfa",
  "/api/roadmap",
];

export function isPendingWorkspacePath(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  return PREFIXES.some((prefix) => {
    const root = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return pathname === root || pathname.startsWith(`${root}/`);
  });
}
