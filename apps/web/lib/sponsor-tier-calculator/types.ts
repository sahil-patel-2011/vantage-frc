// Sponsor tier/benefit calculator domain types. Pure data shapes — no I/O, no framework imports.
// Reads the existing `sponsors` / `sponsor_contributions` tables (season giving) and pairs it
// with org-defined tier thresholds + a per-season benefit-fulfillment checklist.

/** Mirrors the existing `sponsor_tier` enum used on the `sponsors` table (0035). */
export type AssignedSponsorTier = "in_kind" | "bronze" | "silver" | "gold" | "platinum" | "custom";

export type SponsorTierDefinition = {
  id: string;
  name: string;
  minAmountUsd: number;
  benefits: string[];
  sortOrder: number;
};

export type SponsorTierBenefitStatus = {
  benefit: string;
  fulfilled: boolean;
  fulfilledAt: string | null;
  notes: string | null;
};

export type SponsorTierCalcRow = {
  sponsorId: string;
  sponsorName: string;
  assignedTier: AssignedSponsorTier;
  totalGivenUsd: number;
  calculatedTierId: string | null;
  calculatedTierName: string | null;
  nextTierId: string | null;
  nextTierName: string | null;
  amountToNextTierUsd: number | null;
  benefits: SponsorTierBenefitStatus[];
  fulfilledCount: number;
  totalBenefitCount: number;
};

export type SponsorTierCalculatorSummary = {
  totalSponsors: number;
  totalRaisedUsd: number;
  tierCounts: Array<{ tierId: string; tierName: string; count: number }>;
  belowLowestTierCount: number;
  totalBenefitPairs: number;
  fulfilledBenefitPairs: number;
  benefitsFulfilledRate: number;
};
