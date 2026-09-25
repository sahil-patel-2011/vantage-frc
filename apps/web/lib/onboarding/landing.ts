/**
 * Role-aware landing for a finished onboarding.
 *
 * Instead of a bare redirect, a person who completes onboarding *and already has
 * a team* sees the first five things worth doing, drawn from the same
 * role-onboarding tracks `/start` will show them — so a scout lands on scouting
 * links and a mentor lands on team-admin links.
 *
 * The checks come from `lib/role-onboarding/tracks.ts` (real product routes, no
 * invented progress); the org-wide setup path fills any remainder from
 * `lib/onboarding-workflow.ts`.
 */

// Leaf imports on purpose: `lib/role-onboarding/index.ts` re-exports compute.ts,
// which is Node-only DB code. This module is bundled into the client.
import { TEAM_SETUP_TRACK, assignOnboardingTracks } from "../role-onboarding/assign";
import { TRACK_BY_KEY } from "../role-onboarding/tracks";
import { onboardingHubLinks } from "../onboarding-workflow";
import { LEAD_ONLY_PATHS, firstWeekTrackRank, isMemberRole, pickFirstWeek } from "../role-onboarding/first-week-order";
import type { OnboardingCrew, OnboardingFocus, OnboardingRole } from "./step-model";

export type LandingLink = {
  key: string;
  href: string;
  label: string;
  detail: string;
  /** Which track suggested it — shown as the "why this" caption. */
  reason: string;
};

export type OnboardingLanding = {
  eyebrow: string;
  headline: string;
  summary: string;
  primary: { href: string; label: string };
  secondary: { href: string; label: string } | null;
  /** Ordered track keys, most specific first. */
  trackKeys: string[];
  firstFiveMinutes: LandingLink[];
};

export const FIRST_FIVE_LIMIT = 5;
/** Students and parents get a shorter first list: the three Home's "Your first week" opens on. */
export const MEMBER_FIRST_LIMIT = 3;

/** Where each team-setup step's button goes; Home's setup card uses the same places. */
const SETUP_HREF: Record<string, string> = { invite: "/team/admin?invite=1" };

/** Kept for callers that rank tracks by key; the shared first-week order uses the same rule. */
export function landingTrackRank(trackKey: string): number {
  return firstWeekTrackRank({ key: trackKey, source: "" });
}

function withOrg(href: string, orgId: string | null): string {
  if (!orgId) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Compare ignoring the orgId we append ourselves, so links don't duplicate. */
function basePath(href: string): string {
  return href.split("?")[0] ?? href;
}

const ROLE_HEADLINE: Record<OnboardingRole, string> = {
  student: "You're in. Here's where to start.",
  mentor: "You're in. Here's how to get the team running.",
  coach: "You're in. Here's the season at a glance.",
  parent: "You're in. Here's how to follow the team.",
  other: "You're in. Here's where to start.",
};

const ROLE_SUMMARY: Record<OnboardingRole, string> = {
  student: "Your first steps: pulled from your role and crew, not a generic tour.",
  mentor: "Your first steps: team setup, invites, and the checks that unblock students.",
  coach: "Your first steps: the calendar, travel plans and the event briefing.",
  parent: "Your first steps: announcements, logistics, and how student time is tracked.",
  other: "Your first steps: pulled from your role and focus.",
};

export function buildOnboardingLanding(input: {
  teamRole: OnboardingRole | string | null | undefined;
  crewRole: OnboardingCrew | string | null | undefined;
  roleDescription?: string | null;
  primaryFocus: OnboardingFocus | string | null | undefined;
  orgId: string | null;
  orgName?: string | null;
  platformAdmin?: boolean;
  /** Team membership role (owner, admin, scout, viewer). Owners and admins land on team setup. */
  orgRole?: string | null;
}): OnboardingLanding {
  const role = (
    ["student", "mentor", "coach", "parent", "other"].includes(String(input.teamRole))
      ? input.teamRole
      : "other"
  ) as OnboardingRole;

  const assigned = assignOnboardingTracks({
    orgRole: input.orgRole ?? null,
    teamRole: input.teamRole ?? null,
    crewRole: input.crewRole ?? null,
    roleDescription: input.roleDescription ?? null,
    primaryFocus: input.primaryFocus ?? null,
    subteamNames: [],
  });

  const ordered = [...assigned].sort(
    (a, b) => firstWeekTrackRank({ key: a.trackKey, source: a.source }) - firstWeekTrackRank({ key: b.trackKey, source: b.source }),
  );
  const trackKeys = ordered.map((track) => track.trackKey);
  const orgRole = String(input.orgRole ?? "").toLowerCase();
  const runsTeam = Boolean(input.orgId) && (orgRole === "owner" || orgRole === "admin");

  // Someone who runs the team lands on the same four setup steps Home's setup card shows,
  // with inviting people first: the header promised that, and a list of pages to open
  // (Event day, My Day) led an empty team to empty screens.
  if (runsTeam) {
    const setup = TRACK_BY_KEY[TEAM_SETUP_TRACK]?.checks ?? [];
    return {
      eyebrow: "YOU'RE IN",
      headline: "You're in. Four steps get the team going.",
      summary: input.orgName
        ? `Home keeps these steps for ${input.orgName} until they're done.`
        : "Home keeps these steps until they're done.",
      primary: { href: withOrg("/team/admin?invite=1", input.orgId), label: "Invite your team" },
      secondary: { href: withOrg("/dashboard", input.orgId), label: "Open Home" },
      trackKeys,
      firstFiveMinutes: setup.map((check) => ({
        key: `${TEAM_SETUP_TRACK}:${check.key}`,
        href: withOrg(SETUP_HREF[check.key] ?? check.href ?? "/dashboard", input.orgId),
        label: check.label,
        detail: check.detail.replace(/\s*Ticks once[^.]*\.\s*$/i, "").trim(),
        reason: "Team setup",
      })),
    };
  }

  // A student or parent who just joined gets a short list of things they do themselves;
  // assigning quals and running Event day are a lead's jobs. The list is the one Home's
  // "Your first week" opens on (same order, same filter).
  const member = isMemberRole(role);
  const limit = member ? MEMBER_FIRST_LIMIT : FIRST_FIVE_LIMIT;
  const tracks = ordered.map((track) => ({
    key: track.trackKey,
    source: track.source,
    reason: track.reason,
    checks: (TRACK_BY_KEY[track.trackKey]?.checks ?? []).filter((check) => check.href),
  }));
  const links: LandingLink[] = pickFirstWeek(tracks, { limit, member }).map(({ track, check }) => ({
    key: `${track.key}:${check.key}`,
    href: withOrg(check.href!, input.orgId),
    label: check.label,
    detail: check.detail,
    reason: track.reason,
  }));
  const seen = new Set(links.map((link) => basePath(link.href)));
  const allowed = (href: string) => !member || !LEAD_ONLY_PATHS.some((path) => href.startsWith(path));

  // Fill from the org-wide setup path when the profile was too sparse to
  // produce five (e.g. no crew and no focus yet).
  if (links.length < limit && input.orgId) {
    for (const hub of onboardingHubLinks(input.orgId)) {
      if (links.length >= limit) break;
      if (!allowed(hub.href)) continue;
      const key = basePath(hub.href);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        key: `hub:${key}`,
        href: hub.href,
        label: hub.label,
        detail: "Part of the team's shared setup path.",
        reason: "Team setup path",
      });
    }
  }

  const primary = input.platformAdmin && !input.orgId
    ? { href: "/admin", label: "Open platform admin" }
    : input.orgId
      ? { href: withOrg("/dashboard", input.orgId), label: "Open Home" }
      : { href: "/workspace", label: "Choose your team" };

  const secondary = input.orgId
    ? {
        href: withOrg(role === "student" ? "/start" : "/team/getting-started", input.orgId),
        label: role === "student" ? "Your path this week" : "Team setup checklist",
      }
    : null;

  return {
    eyebrow: "YOU'RE IN",
    headline: ROLE_HEADLINE[role],
    summary: input.orgName
      ? `${ROLE_SUMMARY[role]} Working in ${input.orgName}.`
      : ROLE_SUMMARY[role],
    primary,
    secondary,
    trackKeys,
    firstFiveMinutes: links,
  };
}
