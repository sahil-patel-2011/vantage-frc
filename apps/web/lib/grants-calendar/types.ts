// Grant calendar domain types. Pure data shapes — no I/O.
//
// Evidence: mentors ask "Is there a way to sign up for an email notification when the Boeing
// grant opens?" (docs/archive/COMMUNITY_DEMAND_RND.md). The product is the maintained calendar plus
// eligibility filtering that is HONEST about what it does not know.

/** Rules stored on `grant_calendar_opportunities.eligibility` (jsonb). Every key optional. */
export type GrantEligibilityRules = {
  /** Max seasons since rookie year, inclusive (rookie season counts as 1). */
  teamAgeMax?: number;
  /** Min seasons since rookie year, inclusive. */
  teamAgeMin?: number;
  /** Rookie season only. */
  rookieOnly?: boolean;
  /** Requires (true) or excludes (false) Title I school status. */
  titleI?: boolean;
  /** Allowed state/province or country codes — any match qualifies. */
  region?: string[];
  /** Requires the team to hold its own 501(c)(3). */
  nonprofit501c3?: boolean;
  minStudentCount?: number;
  minMentorCount?: number;
};

export type GrantCalendarOpportunity = {
  id: string;
  /** null = platform-curated row shared by every team. */
  orgId: string | null;
  name: string;
  funder: string;
  url: string | null;
  opensOn: string | null;
  closesOn: string | null;
  typicalAmountUsd: number | null;
  eligibility: GrantEligibilityRules;
  notes: string | null;
  isActive: boolean;
};

/**
 * What the team has actually recorded. `null` means NOT RECORDED — it is never coerced to a
 * default, because a defaulted field silently turns "we don't know" into a confident answer.
 */
export type OrgGrantProfile = {
  orgId: string;
  teamNumber: number | null;
  rookieYear: number | null;
  /** Season used to compute team age (usually the current competition season). */
  seasonYear: number | null;
  stateProv: string | null;
  country: string | null;
  titleI: boolean | null;
  nonprofit501c3: boolean | null;
  studentCount: number | null;
  mentorCount: number | null;
};

export type EligibilityVerdict = "eligible" | "ineligible" | "unknown";

export type EligibilityReason = {
  /** `"none"` = the calendar records no restrictions for this funder. */
  rule: keyof GrantEligibilityRules | "none";
  verdict: EligibilityVerdict;
  /** Mentor-readable sentence. For `unknown` it names the missing field, e.g.
   *  "we don't know your Title I status — record it in Team settings". */
  detail: string;
  /** Set when the verdict is `unknown`: the profile field that would resolve it. */
  missingField?: keyof OrgGrantProfile;
};

export type DeadlineUrgency =
  | "closed"
  | "closing-3"
  | "closing-14"
  | "closing-30"
  | "open"
  | "not-open-yet"
  | "no-date";

export type GrantCalendarMatch = {
  opportunity: GrantCalendarOpportunity;
  /** true | false | "unknown" — unknown is a first-class outcome, not a fallback. */
  eligible: true | false | "unknown";
  reasons: EligibilityReason[];
  /** Profile fields that would turn an `unknown` into a real answer. */
  missingFields: Array<keyof OrgGrantProfile>;
  urgency: DeadlineUrgency;
  daysUntilClose: number | null;
  daysUntilOpen: number | null;
};

/** Milestones the deadline alert worker fires on, in days before close. */
export const ALERT_MILESTONE_DAYS = [30, 14, 3] as const;
export type AlertMilestoneDays = (typeof ALERT_MILESTONE_DAYS)[number];
