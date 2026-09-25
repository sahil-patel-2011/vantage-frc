/**
 * Pure pieces of the platform-admin add-team flow (create org -> seed owner ->
 * invite). The API route does the SQL; everything decidable without a database
 * lives here so it can be smoke-tested.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TEAM_NUMBER_MIN = 1;
export const TEAM_NUMBER_MAX = 99999;
/** One-time owner invite lifetime; matches the member-invite default ceiling. */
export const OWNER_INVITE_HOURS = 168;

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

/** Validate the create-workspace form exactly once, server-side. */
export function validateProvisionInput(input: ProvisionInput): ProvisionValidation {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const ownerEmail = typeof input.ownerEmail === "string" ? input.ownerEmail.trim().toLowerCase() : "";
  const teamNumber = Number(input.teamNumber);

  if (!name) return { ok: false, error: "Organization name is required" };
  if (!slug) return { ok: false, error: "Team slug is required" };
  if (!SLUG_PATTERN.test(slug))
    return { ok: false, error: "Slug must use lowercase letters, numbers, and hyphens" };
  if (!Number.isInteger(teamNumber) || teamNumber < TEAM_NUMBER_MIN || teamNumber > TEAM_NUMBER_MAX)
    return { ok: false, error: `Team number must be between ${TEAM_NUMBER_MIN} and ${TEAM_NUMBER_MAX}` };
  if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
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
};

/** What to do next, in plain words. The technical record is in confirmationDetails. */
export function confirmationLines(confirmation: ProvisionConfirmation): string[] {
  const { owner } = confirmation;
  if (owner.mode === "seeded") {
    return [`${owner.email} is the owner and can sign in now.`];
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
  ];
}

/** Friendly message for the two uniqueness races provisioning can hit. */
export function provisionConflictMessage(errorText: string): string | null {
  const text = errorText.toLowerCase();
  if (!text.includes("duplicate key")) return null;
  if (text.includes("team_number")) return "That team number already has a team";
  if (text.includes("slug")) return "Another team already uses that web address. Change it under Advanced, or check the team isn't already set up";
  return "A team with those details already exists";
}
