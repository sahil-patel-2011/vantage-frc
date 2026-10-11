/**
 * The /claim form's fields, decided without a browser so they can be tested.
 *
 * - It starts blank. It used to fill in the person's saved team number, which for anyone already
 *   on a team was a team that has a workspace, so the claim could only fail.
 * - A number arrives only from an explicit `?teamNumber=` (onboarding links here after the server
 *   said that number has no workspace), and never one of the person's own teams.
 * - The name and the web address follow the number until the person types their own. The
 *   address uses `team-NNNN`, the same as teams a platform admin adds.
 */

export type ClaimFields = { teamNumber: string; name: string; slug: string };

export const EMPTY_CLAIM_FIELDS: ClaimFields = { teamNumber: "", name: "", slug: "" };

/** Digits only, at most five: what the number field keeps of what was typed. */
export function sanitizeClaimTeamNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

export function claimNameFor(teamNumber: string): string {
  return teamNumber ? `Team ${teamNumber}` : "";
}

export function claimSlugFor(teamNumber: string): string {
  return teamNumber ? `team-${teamNumber}` : "";
}

/** A new number: the name and address follow it unless the person changed them. */
export function withClaimTeamNumber(current: ClaimFields, raw: string): ClaimFields {
  const teamNumber = sanitizeClaimTeamNumber(raw);
  const nameFollows = !current.name.trim() || current.name.trim() === claimNameFor(current.teamNumber);
  const slugFollows = !current.slug || current.slug === claimSlugFor(current.teamNumber);
  return {
    teamNumber,
    name: nameFollows ? claimNameFor(teamNumber) : current.name,
    slug: slugFollows ? claimSlugFor(teamNumber) : current.slug,
  };
}

/** The slug sent with the claim: the followed one, or the number's, never blank. */
export function claimSlugToSubmit(fields: ClaimFields): string {
  return fields.slug || claimSlugFor(fields.teamNumber);
}

/**
 * The number to start with: only an explicit `?teamNumber=` that is a real FRC number and not a
 * team this person is already on (that team has a workspace; claiming it can only fail).
 */
export function claimPrefill(query: string | null | undefined, memberTeamNumbers: ReadonlyArray<number | null | undefined>): ClaimFields {
  const raw = query?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return EMPTY_CLAIM_FIELDS;
  const number = Number(raw);
  if (number < 1 || memberTeamNumbers.some((own) => own === number)) return EMPTY_CLAIM_FIELDS;
  return withClaimTeamNumber(EMPTY_CLAIM_FIELDS, String(number));
}
