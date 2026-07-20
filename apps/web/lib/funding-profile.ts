/**
 * Org affiliation + funding paths — Soft-UI Business/Media gates.
 * Pure helpers for post-onboarding edit; never DEMO metrics.
 */

export const FUNDING_AFFILIATION_OPTIONS = [
  "private_school",
  "public_school",
  "community",
] as const;

export type FundingAffiliation = (typeof FUNDING_AFFILIATION_OPTIONS)[number];

export const FUNDING_AFFILIATION_LABELS: Record<FundingAffiliation, string> = {
  private_school: "Private school",
  public_school: "Public school",
  community: "Community team",
};

export type FundingProfileInput = {
  teamAffiliation: FundingAffiliation;
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
};

export type FundingProfileView = FundingProfileInput & {
  orgId: string;
  canEdit: boolean;
};

export function isFundingAffiliation(value: unknown): value is FundingAffiliation {
  return (
    typeof value === "string" &&
    (FUNDING_AFFILIATION_OPTIONS as readonly string[]).includes(value)
  );
}

/** At least one funding path required — same rule as onboarding. */
export function fundingPathsReady(input: {
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
}): boolean {
  return Boolean(input.schoolFunded || input.outsideGrants || input.sponsorsAllowed);
}

export function parseFundingProfileSave(body: unknown): FundingProfileInput {
  if (!body || typeof body !== "object") {
    throw new Error("Funding profile payload is required");
  }
  const raw = body as Record<string, unknown>;
  if (!isFundingAffiliation(raw.teamAffiliation)) {
    throw new Error("Select whether your team is a private school, public school, or community team.");
  }
  const schoolFunded = Boolean(raw.schoolFunded);
  const outsideGrants = Boolean(raw.outsideGrants);
  const sponsorsAllowed = Boolean(raw.sponsorsAllowed);
  if (!fundingPathsReady({ schoolFunded, outsideGrants, sponsorsAllowed })) {
    throw new Error("Select at least one funding path: school funds, outside grants, or sponsors.");
  }
  return {
    teamAffiliation: raw.teamAffiliation,
    schoolFunded,
    outsideGrants,
    sponsorsAllowed,
  };
}
