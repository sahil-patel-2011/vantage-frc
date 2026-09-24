/**
 * Labels for the role-profile editor.
 *
 * Kept in the web app rather than imported from @vantage/core so the editor stays
 * a client component: core's capability module reaches for the database driver,
 * and the labels are presentation anyway. The ids are the contract — they must
 * match ORG_CAPABILITIES and HUB_ACCESS_HUB_IDS.
 */

export const PROFILE_CAPABILITIES = [
  {
    id: "manage_members",
    label: "Invite and manage people",
    hint: "Send, resend and cancel invites. They can't hand out extra powers.",
  },
  {
    id: "manage_team_settings",
    label: "Manage team settings",
    hint: "How people sign in, the current event, and team preferences.",
  },
  {
    id: "manage_api_keys",
    label: "Manage AI keys and connectors",
    hint: "AI keys, connected apps and how much AI the team can use.",
  },
  {
    id: "manage_billing",
    // Vantage is free: what this power guards now is the team's AI usage and limits.
    label: "See AI usage and limits",
    hint: "What the team's AI key has been used for, and the monthly limit. Only an owner can give this.",
  },
] as const;

export const PROFILE_HUBS = [
  { id: "competition", label: "Competition", hint: "Event day, scouting, strategy, pit" },
  { id: "team", label: "Team", hint: "Calendar, chat, people, work, playbook" },
  { id: "build", label: "Build", hint: "Kickoff, CAD, code, robot" },
  { id: "business", label: "Business", hint: "Money, sponsors, grants, outreach" },
  { id: "ai", label: "AI", hint: "Chat, writer, agent" },
  { id: "media", label: "Media", hint: "Content calendar, drafts, kit, impact" },
] as const;

export const BASE_ROLE_COPY = {
  scout: {
    label: "Student",
    hint: "Works in the app: scouting, build, the calendar. You can limit the sections below.",
  },
  admin: {
    label: "Mentor or coach",
    hint: "Can open everything and manage the team, including settings.",
  },
  viewer: { label: "Parent or guest", hint: "Can look, can't change. Good for parents, judges and alumni." },
} as const;

export type ProfileBaseRole = keyof typeof BASE_ROLE_COPY;

/** True when the profiles API refused this person for their role. */
export function isRoleProfileDenied(message: string): boolean {
  return /administrator access|access denied|not a member|forbidden/i.test(message);
}
