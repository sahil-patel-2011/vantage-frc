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
    label: "Invite and manage members",
    hint: "Send, resend and revoke invites. Does not let them hand out capabilities.",
  },
  {
    id: "manage_team_settings",
    label: "Manage team settings",
    hint: "Sign-in policy, the active event, and team preferences.",
  },
  {
    id: "manage_api_keys",
    label: "Manage keys and connectors",
    hint: "Provider keys, The Blue Alliance, model routing and AI budgets.",
  },
  {
    id: "manage_billing",
    label: "Manage billing",
    hint: "Checkout and the billing portal. Only an owner can grant this.",
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
  admin: {
    label: "Admin",
    hint: "Full access to everything, including settings. Cannot be limited to certain hubs.",
  },
  scout: {
    label: "Member",
    hint: "Works in the app: scouting, build, the calendar. Limit the hubs below.",
  },
  viewer: { label: "Viewer", hint: "Read-only. Good for parents, judges and alumni." },
} as const;

export type ProfileBaseRole = keyof typeof BASE_ROLE_COPY;

/** True when the profiles API refused this person for their role. */
export function isRoleProfileDenied(message: string): boolean {
  return /administrator access|access denied|not a member|forbidden/i.test(message);
}
