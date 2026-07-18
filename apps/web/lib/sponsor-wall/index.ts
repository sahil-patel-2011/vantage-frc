export * from "./types";

import type { SponsorWallEntry, SponsorWallSummary, SponsorWallTier } from "./types";

export const SPONSOR_WALL_TIERS: SponsorWallTier[] = [
  "title",
  "platinum",
  "gold",
  "silver",
  "bronze",
  "inkind",
  "partner",
];

const TIER_LABELS: Record<SponsorWallTier, string> = {
  title: "Title Sponsor",
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  inkind: "In-Kind",
  partner: "Partner",
};

/** Order sponsor tiers by prominence — used for both wall rendering and the tier breakdown. */
const TIER_RANK: Record<SponsorWallTier, number> = {
  title: 0,
  platinum: 1,
  gold: 2,
  silver: 3,
  bronze: 4,
  inkind: 5,
  partner: 6,
};

export function sponsorWallTierLabel(tier: SponsorWallTier): string {
  return TIER_LABELS[tier] ?? tier;
}

export function tierRank(tier: SponsorWallTier): number {
  return TIER_RANK[tier] ?? TIER_RANK.partner;
}

/** Sort entries the way the public wall renders them: tier prominence, then explicit order, then recency. */
export function sortWallEntries(entries: SponsorWallEntry[]): SponsorWallEntry[] {
  return [...entries].sort((a, b) => {
    const tierDelta = tierRank(a.tier) - tierRank(b.tier);
    if (tierDelta !== 0) return tierDelta;
    const orderDelta = a.displayOrder - b.displayOrder;
    if (orderDelta !== 0) return orderDelta;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export function summarizeWall(entries: SponsorWallEntry[]): SponsorWallSummary {
  const totalEntries = entries.length;
  const publishedEntries = entries.filter((entry) => entry.published).length;
  const byTierMap = new Map<SponsorWallTier, number>();
  for (const entry of entries) {
    byTierMap.set(entry.tier, (byTierMap.get(entry.tier) ?? 0) + 1);
  }
  const byTier = SPONSOR_WALL_TIERS.filter((tier) => byTierMap.has(tier)).map((tier) => ({
    tier,
    count: byTierMap.get(tier) ?? 0,
  }));

  return { totalEntries, publishedEntries, byTier };
}
