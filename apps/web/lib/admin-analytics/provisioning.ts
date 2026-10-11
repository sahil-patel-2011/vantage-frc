/**
 * Pure pieces of the platform-admin add-team flow (create org -> seed owner ->
 * invite). The API route does the SQL; everything decidable without a database
 * lives here so it can be smoke-tested.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TEAM_NUMBER_MIN = 1;
export const TEAM_NUMBER_MAX = 99999;
/** One-time owner invite lifetime; matches the member-invite default ceiling. */
export const OWNER_INVITE_HOURS = 24;

export type ProvisionInput = {
  name?: unknown;
  slug?: unknown;
  teamNumber?: unknown;
  ownerEmail?: unknown;
};

export type ValidProvisionInput = {
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string;
};

export type ProvisionValidation =
  | { ok: true; value: ValidProvisionInput }
  | { ok: false; error: string };

export const TEAM_NAME_MAX = 80;
const EMAIL_MAX = 254;

/**
 * A team number exactly as typed: a whole number, or digits only. `Number()` alone turned `true`
 * into team #1, and `"9e3"`, `" 9202 "` and `[5]` into numbers too (QA A2-12: a stray team #1).
 */
export function parseTeamNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\d{1,5}$/.test(value)) return Number(value);
  return null;
}

/** Validate the create-workspace form exactly once, server-side. */
export function validateProvisionInput(input: ProvisionInput): ProvisionValidation {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const ownerEmail = typeof input.ownerEmail === "string" ? input.ownerEmail.trim().toLowerCase() : "";
  const teamNumber = parseTeamNumber(input.teamNumber);

  if (!name) return { ok: false, error: "Organization name is required" };
  if (name.length > TEAM_NAME_MAX) return { ok: false, error: `Keep the team name to ${TEAM_NAME_MAX} characters` };
  if (!slug) return { ok: false, error: "Team slug is required" };
  if (!SLUG_PATTERN.test(slug) || slug.length > 64)
    return { ok: false, error: "Slug must use lowercase letters, numbers, and hyphens" };
  if (teamNumber === null || teamNumber < TEAM_NUMBER_MIN || teamNumber > TEAM_NUMBER_MAX)
    return { ok: false, error: `Team number must be between ${TEAM_NUMBER_MIN} and ${TEAM_NUMBER_MAX}` };
  if (!ownerEmail || ownerEmail.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
    return { ok: false, error: "A valid owner email is required" };
  return { ok: true, value: { name, slug, teamNumber, ownerEmail } };
}

export type OwnerProvisionMode = "seeded" | "invited";

/**
 * How the first owner lands in the new workspace:
 * - a verified Vantage account → membership seeded immediately;
 * - no account (or unverified) → a one-time owner invite link instead of the
 *   old hard failure ("The first owner must have a verified Vantage account").
 */
export function ownerProvisionMode(owner: { id: string; emailVerified: boolean } | null): OwnerProvisionMode {
  return owner && owner.emailVerified ? "seeded" : "invited";
}

export type ProvisionConfirmation = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  owner: {
    email: string;
    mode: OwnerProvisionMode;
    /** One-time link; shown exactly once, never persisted in plain text. */
    inviteUrl?: string;
    inviteExpiresAt?: string;
    emailSent?: boolean;
    /** "local" logs the email instead of sending it, so it does not count as sent. */
    delivery?: string;
  };
  /**
   * Starter scout forms, finance categories and the owner's Home ("ready" once added; an invited
   * owner's team gets them when the owner accepts). A /claim team gets the same set.
   */
  teamDefaults?: "ready" | "on_owner_join" | "pending";
  /** A waitlist entry for the owner's email was marked converted. */
  waitlistConverted?: boolean;
};

/** What to do next, in plain words. The technical record is in confirmationDetails. */
export function confirmationLines(confirmation: ProvisionConfirmation): string[] {
  const { owner } = confirmation;
  if (owner.mode === "seeded") {
    // Someone who already has an account is made owner at once. Say whether anyone told them:
    // "is the owner" alone left the admin thinking the hand-off was done (QA A2-08).
    const emailed = owner.emailSent && owner.delivery !== "local" && owner.delivery !== "unconfigured";
    return [
      emailed
        ? `${owner.email} already had an account and is the owner now. We emailed them, and they'll see a note when they sign in.`
        : `${owner.email} already had an account and is the owner now. Email isn't set up here, so tell them yourself. They'll see a note when they sign in.`,
    ];
  }
  const expires = owner.inviteExpiresAt
    ? ` It expires ${new Date(owner.inviteExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`
    : "";
  return [
    owner.emailSent && owner.delivery !== "local" && owner.delivery !== "unconfigured"
      ? `We emailed an owner invite to ${owner.email}.${expires}`
      : `Email isn't set up here, so copy the invite link below and send it to ${owner.email}.${expires}`,
  ];
}

/** The record for a platform admin who wants it: web address, billing row, how the owner was added. */
export function confirmationDetails(confirmation: ProvisionConfirmation): string[] {
  return [
    `Web address: ${confirmation.slug}`,
    "Billing: free tier, no AI credit (teams bring their own key).",
    confirmation.owner.mode === "seeded"
      ? "Owner: existing verified account, added directly."
      : "Owner: no verified account yet, so a one-time invite was created. The link is shown once and not stored.",
    ...(confirmation.teamDefaults ? [teamDefaultsLine(confirmation.teamDefaults)] : []),
    ...(confirmation.waitlistConverted ? ["Waitlist: this email's request is marked converted."] : []),
  ];
}

function teamDefaultsLine(state: NonNullable<ProvisionConfirmation["teamDefaults"]>): string {
  if (state === "ready") return "Starter scout forms, finance categories and the owner's Home are ready.";
  if (state === "on_owner_join") return "Starter scout forms, finance categories and Home are added when the owner accepts.";
  return "Starter scout forms could not be added. The owner can publish forms from Competition → Forms.";
}

/**
 * The most likely provisioning mistake (a waitlisted mentor whose team is already on Vantage),
 * checked before the insert so it is named for what it is. The insert used to hit the web-address
 * index first and send the admin to a field folded under Advanced (QA A2-07).
 */
export function teamNumberTakenMessage(teamNumber: number, existingName: string | null): string {
  const name = existingName?.trim();
  const label = name && name !== `Team ${teamNumber}` ? ` (${name})` : "";
  return `Team ${teamNumber} already has a team${label}. Find it in the list on the right.`;
}

/** Friendly message for the two uniqueness races provisioning can hit. */
export function provisionConflictMessage(errorText: string): string | null {
  const text = errorText.toLowerCase();
  if (!text.includes("duplicate key")) return null;
  if (text.includes("team_number")) return "That team number already has a team. Find it in the list on the right.";
  if (text.includes("slug")) return "Another team already uses that web address. Change it under Advanced, or check the team isn't already set up";
  return "A team with those details already exists";
}

/** An owner invite that has run out, from the admin team list's point of view. */
export function ownerInviteExpired(expiresAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  return Number.isFinite(at) && at <= now.getTime();
}
