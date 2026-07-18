// Pure helper functions for collaborative pick-list computation — no I/O, unit-testable.

import type {
  PicklistCollabEntry,
  PicklistCollabSummary,
  PicklistCollabTier,
  PicklistCollabVote,
} from "./types";

export const PICKLIST_COLLAB_TIERS: PicklistCollabTier[] = [
  "first_pick",
  "second_pick",
  "avoid",
  "unranked",
];

export function picklistCollabTierLabel(tier: PicklistCollabTier): string {
  switch (tier) {
    case "first_pick":
      return "First pick";
    case "second_pick":
      return "Second pick";
    case "avoid":
      return "Avoid";
    case "unranked":
      return "Unranked";
    default:
      return tier;
  }
}

/** Sum of vote weights for an entry — the consensus signal used to sort within a tier. */
export function weightedScore(votes: PicklistCollabVote[]): number {
  return Math.round(votes.reduce((sum, vote) => sum + vote.weight, 0) * 100) / 100;
}

/** Weight-averaged rank suggestion across voters who supplied one; null if nobody did. */
export function averageRankSuggestion(votes: PicklistCollabVote[]): number | null {
  const withRank = votes.filter((v) => v.rankSuggestion != null);
  if (withRank.length === 0) return null;
  const weightSum = withRank.reduce((sum, v) => sum + v.weight, 0);
  if (weightSum <= 0) return null;
  const weighted = withRank.reduce((sum, v) => sum + v.weight * (v.rankSuggestion as number), 0);
  return Math.round((weighted / weightSum) * 10) / 10;
}

/**
 * Order entries within their tier by weighted vote score (descending), falling back to the
 * manually-set position, then team number for stability.
 */
export function sortEntriesForDisplay(entries: PicklistCollabEntry[]): PicklistCollabEntry[] {
  const tierRank: Record<PicklistCollabTier, number> = {
    first_pick: 0,
    second_pick: 1,
    avoid: 3,
    unranked: 2,
  };
  return [...entries].sort((a, b) => {
    const tierDiff = tierRank[a.tier] - tierRank[b.tier];
    if (tierDiff !== 0) return tierDiff;
    const scoreDiff = b.weightedScore - a.weightedScore;
    if (scoreDiff !== 0) return scoreDiff;
    const posDiff = a.position - b.position;
    if (posDiff !== 0) return posDiff;
    return a.teamNumber - b.teamNumber;
  });
}

export function summarizePicklistCollab(entries: PicklistCollabEntry[]): PicklistCollabSummary {
  const totalEntries = entries.length;
  const totalVotes = entries.reduce((sum, e) => sum + e.votes.length, 0);
  const voterIds = new Set<string>();
  for (const entry of entries) {
    for (const vote of entry.votes) voterIds.add(vote.voterId);
  }
  const byTier = PICKLIST_COLLAB_TIERS.map((tier) => ({
    tier,
    count: entries.filter((e) => e.tier === tier).length,
  }));
  return {
    totalEntries,
    totalVotes,
    totalVoters: voterIds.size,
    byTier,
  };
}

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(0.1, Math.round(value * 100) / 100));
}
