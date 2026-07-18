// Pure, unit-testable helpers for the sponsor tier/benefit calculator. No I/O.

export * from "./types";
import type {
  AssignedSponsorTier,
  SponsorTierBenefitStatus,
  SponsorTierCalcRow,
  SponsorTierCalculatorSummary,
  SponsorTierDefinition,
} from "./types";

export const ASSIGNED_SPONSOR_TIERS: AssignedSponsorTier[] = [
  "in_kind",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "custom",
];

const ASSIGNED_TIER_LABEL: Record<AssignedSponsorTier, string> = {
  in_kind: "In-kind",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  custom: "Custom",
};

export function assignedTierLabel(tier: AssignedSponsorTier): string {
  return ASSIGNED_TIER_LABEL[tier] ?? tier;
}

/** Sorts tier definitions from highest threshold to lowest — the order used to pick a match. */
export function sortTiersDescending(tiers: SponsorTierDefinition[]): SponsorTierDefinition[] {
  return [...tiers].sort((a, b) => {
    if (b.minAmountUsd !== a.minAmountUsd) return b.minAmountUsd - a.minAmountUsd;
    return a.sortOrder - b.sortOrder;
  });
}

/** Finds the highest tier whose threshold the sponsor's total giving meets or exceeds. */
export function determineCalculatedTier(
  totalGivenUsd: number,
  tiersDescending: SponsorTierDefinition[],
): SponsorTierDefinition | null {
  for (const tier of tiersDescending) {
    if (totalGivenUsd >= tier.minAmountUsd) return tier;
  }
  return null;
}

/** Finds the next tier up (lowest threshold strictly above the current giving total). */
export function determineNextTier(
  totalGivenUsd: number,
  tiersDescending: SponsorTierDefinition[],
): SponsorTierDefinition | null {
  const above = tiersDescending.filter((tier) => tier.minAmountUsd > totalGivenUsd);
  if (above.length === 0) return null;
  return above.reduce((closest, tier) => (tier.minAmountUsd < closest.minAmountUsd ? tier : closest));
}

export type SponsorInput = {
  id: string;
  name: string;
  tier: AssignedSponsorTier;
};

export type FulfillmentInput = {
  sponsorId: string;
  benefit: string;
  fulfilled: boolean;
  fulfilledAt: string | null;
  notes: string | null;
};

export function buildSponsorTierRows(input: {
  sponsors: SponsorInput[];
  contributionTotals: Map<string, number>;
  tiers: SponsorTierDefinition[];
  fulfillments: FulfillmentInput[];
}): SponsorTierCalcRow[] {
  const tiersDescending = sortTiersDescending(input.tiers);
  const fulfillmentsBySponsor = new Map<string, FulfillmentInput[]>();
  for (const record of input.fulfillments) {
    const list = fulfillmentsBySponsor.get(record.sponsorId) ?? [];
    list.push(record);
    fulfillmentsBySponsor.set(record.sponsorId, list);
  }

  return input.sponsors.map((sponsor) => {
    const totalGivenUsd = round2(input.contributionTotals.get(sponsor.id) ?? 0);
    const calculatedTier = determineCalculatedTier(totalGivenUsd, tiersDescending);
    const nextTier = determineNextTier(totalGivenUsd, tiersDescending);
    const fulfillmentBySponsor = fulfillmentsBySponsor.get(sponsor.id) ?? [];
    const fulfillmentByBenefit = new Map(fulfillmentBySponsor.map((f) => [f.benefit, f]));

    const benefits: SponsorTierBenefitStatus[] = (calculatedTier?.benefits ?? []).map((benefit) => {
      const record = fulfillmentByBenefit.get(benefit);
      return {
        benefit,
        fulfilled: record?.fulfilled ?? false,
        fulfilledAt: record?.fulfilledAt ?? null,
        notes: record?.notes ?? null,
      };
    });

    return {
      sponsorId: sponsor.id,
      sponsorName: sponsor.name,
      assignedTier: sponsor.tier,
      totalGivenUsd,
      calculatedTierId: calculatedTier?.id ?? null,
      calculatedTierName: calculatedTier?.name ?? null,
      nextTierId: nextTier?.id ?? null,
      nextTierName: nextTier?.name ?? null,
      amountToNextTierUsd: nextTier ? round2(nextTier.minAmountUsd - totalGivenUsd) : null,
      benefits,
      fulfilledCount: benefits.filter((b) => b.fulfilled).length,
      totalBenefitCount: benefits.length,
    };
  });
}

export function summarizeSponsorTierCalculator(
  rows: SponsorTierCalcRow[],
  tiers: SponsorTierDefinition[],
): SponsorTierCalculatorSummary {
  const totalRaisedUsd = round2(rows.reduce((sum, row) => sum + row.totalGivenUsd, 0));
  const tierCounts = sortTiersDescending(tiers).map((tier) => ({
    tierId: tier.id,
    tierName: tier.name,
    count: rows.filter((row) => row.calculatedTierId === tier.id).length,
  }));
  const belowLowestTierCount = rows.filter((row) => row.calculatedTierId === null).length;
  const totalBenefitPairs = rows.reduce((sum, row) => sum + row.totalBenefitCount, 0);
  const fulfilledBenefitPairs = rows.reduce((sum, row) => sum + row.fulfilledCount, 0);

  return {
    totalSponsors: rows.length,
    totalRaisedUsd,
    tierCounts,
    belowLowestTierCount,
    totalBenefitPairs,
    fulfilledBenefitPairs,
    benefitsFulfilledRate: totalBenefitPairs > 0 ? fulfilledBenefitPairs / totalBenefitPairs : 0,
  };
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
