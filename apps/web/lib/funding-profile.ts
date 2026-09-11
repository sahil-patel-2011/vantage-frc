/**
 * Org affiliation + funding model — Business hub gates.
 * Pure helpers for post-onboarding edit.
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

export const FUNDING_MODEL_OPTIONS = [
  "self_funded",
  "school_funded_no_sponsors",
  "sponsored",
  "school_related_sponsored",
] as const;

export type FundingModel = (typeof FUNDING_MODEL_OPTIONS)[number];

export const FUNDING_MODEL_LABELS: Record<FundingModel, string> = {
  self_funded: "We pay for the team ourselves — dues and fundraisers",
  school_funded_no_sponsors: "The school pays, and we are not allowed to have sponsors",
  sponsored: "Companies and donors sponsor us",
  school_related_sponsored: "The school helps, and we also have sponsors",
};

export type FundingProfileInput = {
  teamAffiliation: FundingAffiliation;
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
  fundingModel: FundingModel;
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

export function isFundingModel(value: unknown): value is FundingModel {
  return typeof value === "string" && (FUNDING_MODEL_OPTIONS as readonly string[]).includes(value);
}

export function flagsFromFundingModel(model: FundingModel): {
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
} {
  switch (model) {
    case "self_funded":
      return { schoolFunded: false, outsideGrants: true, sponsorsAllowed: false };
    case "school_funded_no_sponsors":
      return { schoolFunded: true, outsideGrants: false, sponsorsAllowed: false };
    case "sponsored":
      return { schoolFunded: false, outsideGrants: true, sponsorsAllowed: true };
    case "school_related_sponsored":
      return { schoolFunded: true, outsideGrants: true, sponsorsAllowed: true };
    default: {
      const _never: never = model;
      return _never;
    }
  }
}

export function fundingModelFromFlags(input: {
  schoolFunded: boolean;
  sponsorsAllowed: boolean;
}): FundingModel {
  if (input.schoolFunded && !input.sponsorsAllowed) return "school_funded_no_sponsors";
  if (input.schoolFunded && input.sponsorsAllowed) return "school_related_sponsored";
  if (!input.schoolFunded && input.sponsorsAllowed) return "sponsored";
  return "self_funded";
}

/** At least one funding path required — same rule as onboarding. */
export function fundingPathsReady(input: {
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
  fundingModel?: FundingModel | null;
}): boolean {
  if (input.fundingModel && isFundingModel(input.fundingModel)) return true;
  return Boolean(input.schoolFunded || input.outsideGrants || input.sponsorsAllowed);
}

export function parseFundingProfileSave(body: unknown): FundingProfileInput {
  if (!body || typeof body !== "object") {
    throw new Error("Funding profile payload is required");
  }
  const raw = body as Record<string, unknown>;
  if (!isFundingAffiliation(raw.teamAffiliation)) {
    throw new Error("Choose whether your team is a private school, public school, or community team.");
  }
  let fundingModel: FundingModel;
  let schoolFunded: boolean;
  let outsideGrants: boolean;
  let sponsorsAllowed: boolean;
  if (isFundingModel(raw.fundingModel)) {
    fundingModel = raw.fundingModel;
    const flags = flagsFromFundingModel(fundingModel);
    schoolFunded = flags.schoolFunded;
    outsideGrants = flags.outsideGrants;
    sponsorsAllowed = flags.sponsorsAllowed;
  } else {
    schoolFunded = Boolean(raw.schoolFunded);
    outsideGrants = Boolean(raw.outsideGrants);
    sponsorsAllowed = Boolean(raw.sponsorsAllowed);
    if (!fundingPathsReady({ schoolFunded, outsideGrants, sponsorsAllowed })) {
      throw new Error("Choose how the team is funded: ourselves, the school, sponsors, or both.");
    }
    fundingModel = fundingModelFromFlags({ schoolFunded, sponsorsAllowed });
  }
  return {
    teamAffiliation: raw.teamAffiliation,
    schoolFunded,
    outsideGrants,
    sponsorsAllowed,
    fundingModel,
  };
}

/** Business hub landing tab — dues first for self-funded, pipeline first for sponsored. */
export function businessDefaultTab(model: FundingModel | null | undefined): "overview" | "finance" | "sponsors" | "evidence" {
  switch (model) {
    case "self_funded":
      return "evidence";
    case "school_funded_no_sponsors":
      return "finance";
    case "sponsored":
    case "school_related_sponsored":
      return "sponsors";
    case undefined:
    case null:
      return "overview";
    default: {
      const _never: never = model;
      return _never;
    }
  }
}
