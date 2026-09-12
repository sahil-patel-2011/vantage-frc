// Pure helper functions for collaborative pick-list computation — no I/O, unit-testable.

import type {
  EpaRoleId,
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

export function fieldEpaBenchmarks(totals: number[]): { median: number; p75: number } | null {
  const sorted = totals.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length < 4) return null;
  const at = (p: number) => {
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    const low = sorted[lo] ?? 0;
    const high = sorted[hi] ?? low;
    return lo === hi ? low : low + (high - low) * (index - lo);
  };
  return { median: at(0.5), p75: at(0.75) };
}

/**
 * Copy of F.A.S.T. alliance-selection roles, driven only by cached season-rating shares.
 * Returns null when totals are missing — never invents a role.
 */
export function classifyEpaRole(input: {
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  fieldMedian: number | null;
  fieldP75: number | null;
}): EpaRoleId | null {
  const total = input.epaTotal;
  if (total == null || total <= 0) return null;
  const autoShare = input.epaAuto != null ? input.epaAuto / total : null;
  const teleopShare = input.epaTeleop != null ? input.epaTeleop / total : null;
  if (autoShare == null && teleopShare == null) return null;
  const elite = input.fieldP75 != null && total >= input.fieldP75;
  const aboveMedian = input.fieldMedian != null && total >= input.fieldMedian;

  if (elite && autoShare != null && autoShare >= 0.38 && teleopShare != null && teleopShare >= 0.38) {
    return "elite_all_around";
  }
  if (elite && autoShare != null && autoShare >= 0.4) return "elite_auto";
  if (autoShare != null && autoShare >= 0.45) return "auto_specialist";
  if (teleopShare != null && teleopShare >= 0.62 && (aboveMedian || elite)) return "primary_scorer";
  if (aboveMedian && autoShare != null && autoShare >= 0.25 && autoShare <= 0.45) return "high_value_hybrid";
  if (teleopShare != null && teleopShare >= 0.55) return "teleop_reliable";
  if (autoShare != null && autoShare >= 0.28) return "auto_contributor";
  return null;
}

export function epaRoleLabel(role: EpaRoleId): string {
  switch (role) {
    case "elite_auto":
      return "Elite auto";
    case "elite_all_around":
      return "Elite all-around";
    case "auto_specialist":
      return "Auto specialist";
    case "primary_scorer":
      return "Primary scorer";
    case "high_value_hybrid":
      return "High-value hybrid";
    case "teleop_reliable":
      return "Teleop reliable";
    case "auto_contributor":
      return "Auto contributor";
    default:
      return role;
  }
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Pick List Maker-style CSV for drive-team / coach share-out. */
export function picklistToCsv(input: {
  listName: string;
  entries: PicklistCollabEntry[];
}): string {
  const header = [
    "List",
    "Team",
    "Name",
    "Tier",
    "Role",
    "Season rating",
    "Auto rating",
    "Teleop rating",
    "Weighted score",
    "Note",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const entry of input.entries) {
    lines.push(
      [
        input.listName,
        entry.teamNumber,
        entry.teamName ?? "",
        picklistCollabTierLabel(entry.tier),
        entry.epaRole ? epaRoleLabel(entry.epaRole) : "",
        entry.epaTotal ?? "",
        entry.epaAuto ?? "",
        entry.epaTeleop ?? "",
        entry.weightedScore,
        entry.note ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
