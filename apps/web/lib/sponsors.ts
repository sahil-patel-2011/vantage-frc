export const SPONSOR_TIERS = ["in_kind", "bronze", "silver", "gold", "platinum", "custom"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];
export const SPONSOR_STATUSES = ["prospect", "active", "lapsed", "declined"] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];

export type Contribution = {
  type: "cash" | "in_kind" | "discount";
  amountUsd: number | null;
  estimatedValueUsd: number | null;
  seasonYear: number;
};

export function summarizeContributions(contributions: Contribution[], seasonYear?: number) {
  const scoped = seasonYear == null ? contributions : contributions.filter((c) => c.seasonYear === seasonYear);
  const cashUsd = round2(scoped.filter((c) => c.type === "cash").reduce((sum, c) => sum + (c.amountUsd ?? 0), 0));
  const inKindEstimateUsd = round2(
    scoped.filter((c) => c.type !== "cash").reduce((sum, c) => sum + (c.estimatedValueUsd ?? c.amountUsd ?? 0), 0),
  );
  return { cashUsd, inKindEstimateUsd, totalUsd: round2(cashUsd + inKindEstimateUsd) };
}

export function daysSinceLastContact(lastInteractionAt: string | null, now = new Date()) {
  if (!lastInteractionAt) return null;
  const diffMs = now.getTime() - new Date(lastInteractionAt).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function needsFollowUp(lastInteractionAt: string | null, thresholdDays = 60, now = new Date()) {
  const days = daysSinceLastContact(lastInteractionAt, now);
  return days == null || days >= thresholdDays;
}

/** A sponsor is lapsed once their most recent contribution predates the current season. */
export function isLapsed(contributionSeasonYears: number[], currentSeasonYear: number) {
  if (contributionSeasonYears.length === 0) return false;
  return Math.max(...contributionSeasonYears) < currentSeasonYear;
}

const TIER_LABELS: Record<SponsorTier, string> = {
  in_kind: "In-kind",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  custom: "Custom",
};

export function tierLabel(tier: SponsorTier) {
  return TIER_LABELS[tier];
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
