/**
 * Renaming a team, leaving it, deleting it, and deleting your own account.
 *
 * The database does the work (migration 0720: leave_team, delete_team, delete_my_account) and
 * refuses anything not allowed with a `vantage:<reason>` detail. This file turns those refusals
 * into sentences a student, a parent or a mentor can act on, and holds the copy the confirm
 * dialogs show, so the dialog and the policy say the same thing. Pure: no database, no React.
 */

export type LifecycleAction = "rename" | "leave" | "delete_team" | "delete_account";

export type LifecycleRefusal =
  | "not_a_member"
  | "last_owner"
  | "not_owner"
  | "not_allowed"
  | "confirm_mismatch"
  | "paid_plan"
  | "platform_admin"
  | "not_found"
  | "reauth_required"
  | "invalid_name";

/** What a route answers for a refusal: a sentence and the HTTP status. */
export type LifecycleAnswer = { error: string; reason: LifecycleRefusal; status: number };

const STATUS: Record<LifecycleRefusal, number> = {
  not_a_member: 403,
  last_owner: 409,
  not_owner: 403,
  not_allowed: 403,
  confirm_mismatch: 400,
  paid_plan: 409,
  platform_admin: 403,
  not_found: 404,
  reauth_required: 403,
  invalid_name: 400,
};

export function refusalMessage(reason: LifecycleRefusal, action: LifecycleAction): string {
  switch (reason) {
    case "not_a_member":
      return action === "leave" ? "You're not on this team, so there's nothing to leave." : "You're not on this team.";
    case "last_owner":
      return action === "delete_account"
        ? "You're the only owner of a team. Hand that team over to someone, or delete it, before you delete your account."
        : "You're this team's only owner. Hand the team over to someone first, or delete the team.";
    case "not_owner":
      return "Only the team owner can delete the team.";
    case "not_allowed":
      return "Only the team owner or a team admin can rename the team.";
    case "confirm_mismatch":
      return action === "delete_account"
        ? "That isn't your email address. Type it exactly to confirm."
        : "That isn't the team number. Type it exactly to confirm.";
    case "paid_plan":
      return action === "delete_account"
        ? "You still have a personal paid plan. Cancel it in Billing first, then delete your account."
        : "This team still has a paid plan. Cancel it in Billing first, then delete the team.";
    case "platform_admin":
      return "You run Vantage itself, so this account can't be deleted here. Ask another platform admin to remove your admin access first.";
    case "not_found":
      return action === "delete_account" ? "That account no longer exists." : "That team no longer exists.";
    case "reauth_required":
      return action === "delete_account"
        ? "For your safety, sign out and sign in again, then delete your account."
        : "For your safety, sign out and sign in again, then delete the team.";
    case "invalid_name":
      return `Give the team a name of 1 to ${TEAM_NAME_MAX} characters.`;
  }
}

export function lifecycleAnswer(reason: LifecycleRefusal, action: LifecycleAction): LifecycleAnswer {
  return { error: refusalMessage(reason, action), reason, status: STATUS[reason] };
}

const REASONS = new Set<string>(Object.keys(STATUS));

/** The refusal behind a database error raised by the 0720 functions, or null for anything else. */
export function lifecycleRefusal(error: unknown): LifecycleRefusal | null {
  if (error instanceof LifecycleError) return error.reason;
  const detail = error && typeof error === "object" ? (error as { detail?: unknown }).detail : null;
  if (typeof detail !== "string" || !detail.startsWith("vantage:")) return null;
  const reason = detail.slice("vantage:".length);
  return REASONS.has(reason) ? (reason as LifecycleRefusal) : null;
}

/** A refusal decided in the route or the store before the database is asked. */
export class LifecycleError extends Error {
  constructor(readonly reason: LifecycleRefusal) {
    super(reason);
    this.name = "LifecycleError";
  }
}

export const TEAM_NAME_MAX = 80;

/** A team name as stored: trimmed, inner runs of spaces made one. Null when it can't be one. */
export function normalizeTeamName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > TEAM_NAME_MAX) return null;
  return name;
}

/** What someone types to delete a team: its number, or its name for a team without one. */
export function teamConfirmPhrase(team: { teamNumber: number | null; name: string }): string {
  return team.teamNumber != null ? String(team.teamNumber) : team.name.trim();
}

/** "Team 9201 · QA 2 Alpha", or just "Team 9201" when the name only repeats the number. */
export function teamDisplayName(team: { teamNumber: number | null; name: string }): string {
  const name = team.name.trim();
  if (team.teamNumber == null) return name || "This team";
  const number = `Team ${team.teamNumber}`;
  return !name || name === number ? number : `${number} · ${name}`;
}

/**
 * A team owner's sign-in must be this recent to delete a team or an account. Someone using an
 * unlocked phone or a shared shop laptop should not be able to wipe a team in one tap.
 */
export const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

export function sessionIsFresh(createdAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!createdAt) return false;
  const started = new Date(createdAt).getTime();
  return Number.isFinite(started) && now.getTime() - started <= FRESH_SESSION_MS;
}

/** Everything a team delete removes, in the words the dialog uses. The database removes it all. */
export const TEAM_DELETION_REMOVES = [
  "Everyone's access to the team",
  "Scouting data, forms and pick lists",
  "Tasks, calendar, attendance and hours",
  "Team chat, files, notes and Ask AI chats",
  "Money records, sponsors and settings",
] as const;

/** What a team delete leaves alone. */
export const TEAM_DELETION_KEEPS =
  "Each person's own Vantage account stays. Everyone on the team gets a note that it was deleted.";

/** Everything an account delete removes. */
export const ACCOUNT_DELETION_REMOVES = [
  "Your place on every team you're on",
  "Your name, email, profile and settings",
  "Your sign-in methods, devices and personal AI keys",
  "Your notifications and private Ask AI chats",
] as const;

/** What an account delete leaves with the team (the Privacy Policy says the same). */
export const ACCOUNT_DELETION_KEEPS =
  "Team work you added, like scouting entries, tasks and files, stays with the team without your name.";
