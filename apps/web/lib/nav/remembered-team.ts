/**
 * Team pages read the team from `?orgId=`. A link that leaves it off (a bookmark, a
 * settings row, an old email) used to land an owner of exactly one team on "Choose your
 * team". proxy.ts now remembers the last team a person opened and fills it in, and falls
 * back to their own membership, so that screen is only for someone with no team at all.
 *
 * The cookie is only a hint: every page still checks membership through RLS, so a stale or
 * edited value shows that page's normal "not on this team" state, never another team's data.
 *
 * It only ever holds a team the person is on. It used to be written for any `?orgId=` that looked
 * like an id, so one click on another team's link (an old email, a link pasted in chat) pinned the
 * person to that team for a year and every bare team page redirected there and failed. The proxy
 * now reads the person's own teams first: a team they're not on is never remembered, a stale
 * cookie falls back to their own team, and a link to another team lands on the team chooser,
 * which says so (notOnTeamRedirect).
 */

import { isKnownAppPath } from "./app-route-roots";

export const REMEMBERED_TEAM_COOKIE = "vantage-team";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTeamId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Server-rendered pages that show "Choose your team" when `?orgId=` is missing. */
export const TEAM_SCOPED_PAGES: ReadonlySet<string> = new Set([
  "/cad/connections",
  "/cad/setup",
  "/chat",
  // The competition hub: its Scouting tab loads with the team from the address, and a
  // bare /competition?tab=scouting used to ask for no team at all ("Could not load scouting").
  "/competition",
  "/display",
  "/exports",
  "/messages",
  "/pit",
  "/scout-accuracy",
  "/scout-coverage-live",
  "/scout-crossval",
  "/scout-data-impact",
  "/scout-disagreements",
  "/scouting/forms",
  "/scouting/lineup",
  "/scouting",
  "/showcase",
  "/team/admin",
  "/team/ai-runs",
  "/team/alumni",
  "/team/audit",
  "/team/background",
  "/team/budgets",
  "/team/data",
  "/team/discord",
  "/team/getting-started",
  "/team/grants",
  "/team/knowledge/history",
  "/team/posture",
  "/team/prompts",
  "/team/security/exports",
  "/team/security",
  "/team/slack",
  "/team/usage",
  "/workspace",
  "/photos",
  "/connectors",
  // Every other page that reads ?orgId (found by scanning app/**/page.tsx for it). Opened from a
  // bookmark without one, they showed "Choose your team" while the top bar named the team.
  "/analytics",
  "/auto-routines",
  "/bringup",
  "/bugbot",
  "/code",
  "/control-map",
  "/fundraisers",
  "/gearbox",
  "/match-debrief",
  "/messages/moderation",
  "/notebook",
  "/notifications",
  "/power-budget",
  "/recognition",
  "/safety",
  "/shooter-table",
  "/software-versions",
  "/start",
  "/subsystems",
  "/team/ai-keys",
  "/team/ai-usage",
  "/team/finance",
  "/team/grants/calendar",
  "/team/sponsors",
  "/tuning",
  "/weight-budget",
  "/wiring",
]);

/**
 * The first candidate that is one of the person's teams, else their first team (the list comes
 * owner-first from memberTeamIds), else null for someone on no team.
 */
export function chooseMemberTeam(memberTeams: readonly string[], ...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (isTeamId(candidate) && memberTeams.includes(candidate)) return candidate;
  }
  return memberTeams[0] ?? null;
}

/** Marks the team chooser as reached from a link to a team the person is not on. */
export const NOT_ON_TEAM_PARAM = "notOnTeam";

/**
 * A page opened for another team goes to the chooser instead, which says "You're not on that
 * team" and links the same page for each of the person's own teams. The other team's id is
 * dropped: nothing about that team is shown or kept.
 */
export function notOnTeamRedirect(url: URL): URL {
  const page = new URL(url.toString());
  page.searchParams.delete("orgId");
  const target = new URL("/workspace", url);
  // The chooser itself is not a destination: its own team's Home is.
  target.searchParams.set("next", page.pathname === "/workspace" ? "/dashboard" : `${page.pathname}${page.search}`);
  target.searchParams.set(NOT_ON_TEAM_PARAM, "1");
  return target;
}

/**
 * Pages about the person or Vantage itself, never one team, and the steps before someone has a
 * team. Nothing is filled in for them. Home reads the person's team itself, and it is where
 * sign-in lands, so it is left alone too (one redirect fewer on every sign-in).
 */
const PERSONAL_PAGES = [
  "/dashboard",
  "/account",
  "/admin",
  "/claim",
  "/consent",
  "/desktop",
  "/docs",
  "/help",
  "/invite",
  "/join",
  "/join-team",
  "/migrate",
  "/notifications/preferences",
  "/offline",
  "/offline-shell",
  "/onboarding",
  "/roadmap",
  "/security",
  // Not /settings: it lists "This team" too, so it opens on the team you are working in.
  "/support",
  "/team-setup",
];

/**
 * Whether a signed-in page is for one team. The list above was kept by hand and had fallen far
 * behind: Build, Business, Calendar, Tasks and most hub tabs opened from a link without
 * `?orgId=` showed "No team selected" (UX audit). Now every signed-in page is a team page unless
 * it is one of the personal pages.
 */
export function isTeamScopedPage(pathname: string): boolean {
  if (TEAM_SCOPED_PAGES.has(pathname)) return true;
  if (pathname === "/" || pathname.includes(".") || pathname.startsWith("/api/")) return false;
  // An address that is no page at all gets its 404 without a membership read.
  if (!isKnownAppPath(pathname)) return false;
  return !PERSONAL_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Where to send a team page that arrived without `?orgId=`, or null to render it as is. */
export function teamPageRedirect(url: URL, teamId: string | null): URL | null {
  if (!isTeamScopedPage(url.pathname) || url.searchParams.get("orgId") || !isTeamId(teamId)) return null;
  const target = new URL(url.toString());
  target.searchParams.set("orgId", teamId);
  return target;
}
