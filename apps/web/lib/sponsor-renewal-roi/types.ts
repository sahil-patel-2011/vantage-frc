// Sponsor Renewal-Risk Score & Auto ROI Report domain types. Pure data shapes — no I/O, no
// framework imports. Reads existing sponsors-CRM interaction/contribution timestamps (0035),
// community-impact mentions (0038), and outreach-evidence-vault entries (0348) tied to a
// sponsor; never fabricates a score component the underlying data cannot support.

export type SponsorRenewalRiskTier = "low" | "moderate" | "high";

/** Each component is 0..1 risk contribution (higher = more churn risk), or null when the
 *  underlying signal has no data to compute from (kept out of the weighted average, not
 *  defaulted to a fabricated value). */
export type SponsorRenewalRiskComponents = {
  interactionRecency: number | null;
  interactionFrequency: number | null;
  contributionRecency: number | null;
  impactMentions: number | null;
  evidenceCoverage: number | null;
  /** Showcase page views are only counted "where tracked" — no view-tracking table exists yet,
   *  so this stays null until that signal is wired up. Never fabricated. */
  showcaseViews: null;
};

export type SponsorRenewalRiskInputs = {
  sponsorId: string;
  sponsorName: string;
  now: Date;
  /** Most recent sponsor_interactions.occurred_at, if any. */
  lastInteractionAt: Date | null;
  /** Count of sponsor_interactions in the trailing 12 months. */
  interactionCount12mo: number;
  /** Most recent sponsor_contributions.received_at, if any. */
  lastContributionAt: Date | null;
  /** Count of impact_activities whose title/description mentions the sponsor by name,
   *  in the trailing 12 months. */
  impactMentionCount12mo: number;
  /**
   * Evidence items attached to those mentioned activities, or `null` when the
   * deployment has nowhere to attach outreach evidence. The table this once read
   * (`outreach_evidence_vault_items`) was never created, so a zero here would be a
   * fabricated measurement of an unimplemented feature rather than "none attached".
   */
  evidenceItemCount: number | null;
};

export type SponsorRenewalRiskScore = {
  sponsorId: string;
  sponsorName: string;
  score: number;
  tier: SponsorRenewalRiskTier;
  components: SponsorRenewalRiskComponents;
  /** True when none of the underlying signals (interactions, contributions, mentions,
   *  evidence) have any recorded activity for this sponsor. */
  noLinkedActivity: boolean;
  daysSinceLastInteraction: number | null;
  daysSinceLastContribution: number | null;
};

export type SponsorRenewalRoiSection = {
  heading: string;
  body: string;
};

export type SponsorRenewalRoiReport = {
  id: string;
  sponsorId: string;
  sponsorName: string;
  seasonYear: number;
  title: string;
  riskScore: number | null;
  sections: SponsorRenewalRoiSection[];
  htmlContent: string;
  createdAt: string;
};

export type SponsorRenewalRoiSponsorSummary = {
  sponsorId: string;
  sponsorName: string;
  tier: string;
  status: string;
  risk: SponsorRenewalRiskScore;
  latestReport: SponsorRenewalRoiReport | null;
};
