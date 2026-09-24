/**
 * Team pages read the team from `?orgId=`. A link that leaves it off (a bookmark, a
 * settings row, an old email) used to land an owner of exactly one team on "Choose your
 * team". proxy.ts now remembers the last team a person opened and fills it in, and falls
 * back to their own membership, so that screen is only for someone with no team at all.
 *
 * The cookie is only a hint: every page still checks membership through RLS, so a stale or
 * edited value shows that page's normal "not on this team" state, never another team's data.
 */

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

/** Where to send a team page that arrived without `?orgId=`, or null to render it as is. */
export function teamPageRedirect(url: URL, teamId: string | null): URL | null {
  if (!TEAM_SCOPED_PAGES.has(url.pathname) || url.searchParams.get("orgId") || !isTeamId(teamId)) return null;
  const target = new URL(url.toString());
  target.searchParams.set("orgId", teamId);
  return target;
}
