/**
 * The one set of words for a person's team access, used by every screen, notification and
 * email. Pool-free and dependency-free, so client components import it too
 * (`@vantage/core/role-words`).
 *
 * The stored roles (org_role) stay `owner`, `admin`, `scout` and `viewer`. People never see
 * those: a parent read "invited as viewer", a scout's access was "Team member" on one screen
 * and "Student" on the next, and a mentor was "Team admin" in one place and "Mentor or coach"
 * in another. These are the words the shell, the roster and the role profiles already used
 * most, now used everywhere, each with one line on what the access lets a person do.
 *
 * What someone says they are in onboarding ("I'm a parent") is separate from their access
 * and is shown as such ("says they're a parent"); see selfDescribedWords.
 */

export type AccessRole = "owner" | "admin" | "scout" | "viewer";

export const ACCESS_ROLES: readonly AccessRole[] = ["owner", "admin", "scout", "viewer"];

/** The access a person can be given from Team admin (owners change by handing over the team). */
export const ASSIGNABLE_ROLES: readonly Exclude<AccessRole, "owner">[] = ["admin", "scout", "viewer"];

export const ROLE_LABELS: Record<AccessRole, string> = {
  owner: "Owner",
  admin: "Mentor or coach",
  scout: "Student",
  viewer: "Parent or guest",
};

/** One line on what the access lets a person do. Shown under every role choice. */
export const ROLE_HINTS: Record<AccessRole, string> = {
  owner: "Runs the team: everything a mentor or coach can do, and can hand the team over.",
  admin: "Invites and removes people, changes team settings and uses every team tool.",
  scout: "Scouts and uses the team's tools: tasks, calendar, chat, build.",
  viewer: "Can look, can't change anything.",
};

/** In a sentence: "joined as a student", "You're now a mentor or coach". */
const ROLE_PHRASES: Record<AccessRole, string> = {
  owner: "an owner",
  admin: "a mentor or coach",
  scout: "a student",
  viewer: "a parent or guest",
};

/** How much a role can do, for "never lower someone by accident" comparisons. */
const ROLE_RANK: Record<AccessRole, number> = { viewer: 0, scout: 1, admin: 2, owner: 3 };

export function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === "string" && (ACCESS_ROLES as readonly string[]).includes(value);
}

function normalized(role: string | null | undefined): AccessRole | null {
  const value = role?.trim().toLowerCase() ?? "";
  return isAccessRole(value) ? value : null;
}

/** "Student" for `scout`. Unknown values read as "Member", never as a raw enum. */
export function roleLabel(role: string | null | undefined): string {
  const known = normalized(role);
  return known ? ROLE_LABELS[known] : "Member";
}

/** "a student" for `scout`; "a member" when unknown. */
export function rolePhrase(role: string | null | undefined): string {
  const known = normalized(role);
  return known ? ROLE_PHRASES[known] : "a member";
}

export function roleHint(role: string | null | undefined): string {
  const known = normalized(role);
  return known ? ROLE_HINTS[known] : "";
}

/** True when `next` gives more access than `current`. */
export function roleOutranks(next: string | null | undefined, current: string | null | undefined): boolean {
  const a = normalized(next);
  const b = normalized(current);
  if (!a) return false;
  if (!b) return true;
  return ROLE_RANK[a] > ROLE_RANK[b];
}

/**
 * What a person said they are in onboarding (profiles.team_role), in a sentence:
 * "a parent". Null for "other" or nothing, so callers can leave it out.
 */
export function selfDescribedWords(teamRole: string | null | undefined): string | null {
  switch (teamRole?.trim().toLowerCase()) {
    case "student":
      return "a student";
    case "mentor":
      return "a mentor";
    case "coach":
      return "a coach";
    case "parent":
      return "a parent";
    default:
      return null;
  }
}

/** The access that usually fits what someone said they are; null when there is no clear fit. */
export function suggestedRoleFor(teamRole: string | null | undefined): AccessRole | null {
  switch (teamRole?.trim().toLowerCase()) {
    case "student":
      return "scout";
    case "mentor":
    case "coach":
      return "admin";
    case "parent":
      return "viewer";
    default:
      return null;
  }
}
