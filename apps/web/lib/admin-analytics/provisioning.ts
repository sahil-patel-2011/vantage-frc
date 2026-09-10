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
  if (!slug) return { ok: false, error: "Workspace slug is required" };
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
  };
};

/** Human summary lines for the confirmation screen — real created rows only. */
export function confirmationLines(confirmation: ProvisionConfirmation): string[] {
  const lines = [
    `Workspace "${confirmation.name}" (#${confirmation.teamNumber}, slug ${confirmation.slug}) created.`,
    "Billing row seeded on the free tier with a $0 credit cap.",
  ];
  if (confirmation.owner.mode === "seeded") {
    lines.push(`${confirmation.owner.email} was seeded as owner — they can open /workspace now.`);
  } else {
    lines.push(
      `${confirmation.owner.email} has no verified Vantage account yet — a one-time owner invite was created instead.`,
    );
    if (confirmation.owner.inviteExpiresAt) {
      lines.push(`The invite link expires ${new Date(confirmation.owner.inviteExpiresAt).toLocaleString()}.`);
    }
    lines.push(
      confirmation.owner.emailSent
        ? "The invite email was sent; the link below is the same one-time URL."
        : "Invite email delivery is not configured — copy the one-time link below and send it yourself.",
    );
  }
  return lines;
}

/** Friendly message for the two uniqueness races provisioning can hit. */
export function provisionConflictMessage(errorText: string): string | null {
  const text = errorText.toLowerCase();
  if (!text.includes("duplicate key")) return null;
  if (text.includes("team_number")) return "That team number already has a team";
  if (text.includes("slug")) return "That workspace slug is already taken";
  return "A workspace with those details already exists";
}
