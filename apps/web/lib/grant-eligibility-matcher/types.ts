// Grant Eligibility Matcher & Deadline Radar domain types. Pure data shapes — no I/O.
// Discovery/matching against the platform-maintained grants catalog, distinct from the
// grant-report post-award compliance surface.

export type GrantDeadlineType = "fixed_date" | "rolling" | "season_open";

export type GrantEligibilityRules = {
  maxRookieYears?: number;
  regions?: string[];
  mentorEmployers?: string[];
  requiresDemographicsFocus?: boolean;
  minStudentCount?: number;
  minMentorCount?: number;
};

export type CatalogGrant = {
  id: string;
  name: string;
  funder: string;
  description: string | null;
  amountMin: number | null;
  amountMax: number | null;
  applicationUrl: string | null;
  eligibilityRules: GrantEligibilityRules;
  deadlineType: GrantDeadlineType;
  deadlineDate: string | null;
  seasonYear: number | null;
  isActive: boolean;
};

export type TeamEligibilityProfile = {
  orgId: string;
  teamNumber: number | null;
  rookieYear: number | null;
  region: string | null;
  country: string | null;
  studentCount: number | null;
  mentorCount: number | null;
  hasDemographicsFocus: boolean;
  mentorEmployers: string[];
  /** Fields the team hasn't filled in yet — used to explain "not yet computable" outcomes. */
  missingFields: string[];
};

export type GrantMatchOutcome = {
  grantId: string;
  isEligible: boolean;
  score: number;
  matchedReasons: string[];
  unmetReasons: string[];
};

export type GrantMatch = GrantMatchOutcome & {
  id: string;
  grant: CatalogGrant;
  deadlineFlaggedAt: string | null;
  dismissedAt: string | null;
  computedAt: string;
  daysUntilDeadline: number | null;
};
