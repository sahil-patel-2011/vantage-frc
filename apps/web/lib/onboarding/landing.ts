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
import { assignOnboardingTracks } from "../role-onboarding/assign";
import { TRACK_BY_KEY } from "../role-onboarding/tracks";
import { onboardingHubLinks } from "../onboarding-workflow";
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

/**
 * Specificity rank: a crew/subteam path beats a focus path beats a role path
 * beats the generic welcome tour. This is what makes a scout's landing
 * scouting-first rather than "open your workspace".
 */
const SPECIALTY_TRACKS = new Set([
  "mechanical",
  "electrical",
  "programming",
  "cad",
  "drive_team",
  "scouting",
  "business",
  "safety",
]);

export function landingTrackRank(trackKey: string): number {
  if (SPECIALTY_TRACKS.has(trackKey)) return 0;
  if (trackKey.startsWith("focus_")) return 1;
  if (trackKey.startsWith("role_")) return 2;
  return 3; // welcome
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
  student: "These five are the first five minutes — pulled from your role and crew, not a generic tour.",
  mentor: "These five are the first five minutes — team setup, invites, and the checks that unblock students.",
  coach: "These five are the first five minutes — calendar, logistics, and the budget guardrails.",
  parent: "These five are the first five minutes — announcements, logistics, and how student time is tracked.",
  other: "These five are the first five minutes — pulled from your role and focus.",
};

export function buildOnboardingLanding(input: {
  teamRole: OnboardingRole | string | null | undefined;
  crewRole: OnboardingCrew | string | null | undefined;
  roleDescription?: string | null;
  primaryFocus: OnboardingFocus | string | null | undefined;
  orgId: string | null;
  orgName?: string | null;
  platformAdmin?: boolean;
}): OnboardingLanding {
  const role = (
    ["student", "mentor", "coach", "parent", "other"].includes(String(input.teamRole))
      ? input.teamRole
      : "other"
  ) as OnboardingRole;

  const assigned = assignOnboardingTracks({
    teamRole: input.teamRole ?? null,
    crewRole: input.crewRole ?? null,
    roleDescription: input.roleDescription ?? null,
    primaryFocus: input.primaryFocus ?? null,
    subteamNames: [],
  });

  const ordered = [...assigned].sort(
    (a, b) => landingTrackRank(a.trackKey) - landingTrackRank(b.trackKey),
  );
  const trackKeys = ordered.map((track) => track.trackKey);

  // Round-robin one check per track so the list spans paths instead of dumping
  // four links from whichever track happened to sort first.
  const links: LandingLink[] = [];
  const seen = new Set<string>();
  const depth = Math.max(
    0,
    ...ordered.map((track) => TRACK_BY_KEY[track.trackKey]?.checks.length ?? 0),
  );
  for (let round = 0; round < depth && links.length < FIRST_FIVE_LIMIT; round += 1) {
    for (const track of ordered) {
      if (links.length >= FIRST_FIVE_LIMIT) break;
      const check = TRACK_BY_KEY[track.trackKey]?.checks[round];
      if (!check?.href) continue;
      const key = basePath(check.href);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        key: `${track.trackKey}:${check.key}`,
        href: withOrg(check.href, input.orgId),
        label: check.label,
        detail: check.detail,
        reason: track.reason,
      });
    }
  }

  // Fill from the org-wide setup path when the profile was too sparse to
  // produce five (e.g. no crew and no focus yet).
  if (links.length < FIRST_FIVE_LIMIT && input.orgId) {
    for (const hub of onboardingHubLinks(input.orgId)) {
      if (links.length >= FIRST_FIVE_LIMIT) break;
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
      ? { href: withOrg("/start", input.orgId), label: "Open your full path" }
      : { href: "/workspace", label: "Choose your team" };

  const secondary = input.orgId
    ? {
        href: withOrg(role === "student" ? "/team/calendar" : "/team/getting-started", input.orgId),
        label: role === "student" ? "Join a subteam calendar" : "Team setup checklist",
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
