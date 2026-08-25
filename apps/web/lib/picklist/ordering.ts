// Pure ordering / vote-aggregation / conflict logic for the ONE pick list.
// No I/O, no DB, no React — unit-tested in ordering.test.ts and reused by store.ts and by
// every surface that renders a pick list.

import type { PickBucket, PickListVote, ReorderConflict } from "./types";

export const PICK_BUCKETS: PickBucket[] = ["first_pick", "second_pick", "unranked", "avoid"];

const BUCKET_ORDER: Record<PickBucket, number> = {
  first_pick: 0,
  second_pick: 1,
  unranked: 2,
  avoid: 3,
};

export function bucketLabel(bucket: PickBucket): string {
  switch (bucket) {
    case "first_pick":
      return "First pick";
    case "second_pick":
      return "Second pick";
    case "avoid":
      return "Avoid";
    case "unranked":
      return "Unranked";
    default:
      return bucket;
  }
}

export function isPickBucket(value: unknown): value is PickBucket {
  return typeof value === "string" && (PICK_BUCKETS as string[]).includes(value);
}

/**
 * Free-text `tier` (what Strategy and Intel/Research write) -> shared bucket vocabulary.
 * Unknown or missing tiers become `unranked` — never a guessed placement.
 */
export function bucketFromTier(tier: string | null | undefined): PickBucket {
  switch ((tier ?? "").trim().toLowerCase()) {
    case "first":
    case "first_pick":
      return "first_pick";
    case "second":
    case "second_pick":
    case "third":
      return "second_pick";
    case "avoid":
    case "do_not_pick":
      return "avoid";
    default:
      return "unranked";
  }
}

/** Bucket -> the legacy `tier` string, kept in sync so pick-desk / Pick Clock keep working. */
export function tierFromBucket(bucket: PickBucket): string | null {
  switch (bucket) {
    case "first_pick":
      return "first";
    case "second_pick":
      return "second";
    case "avoid":
      return "avoid";
    default:
      return null;
  }
}

/** The minimum an entry must expose to be ordered. */
export type OrderableEntry = {
  id: string;
  rank: number;
  bucket: PickBucket;
  teamNumber?: number | null;
};

/**
 * Total order for a pick list: bucket first, then rank, then team number, then id.
 * Fully deterministic — two devices holding identical rows always render the same list.
 */
export function comparePickEntries(a: OrderableEntry, b: OrderableEntry): number {
  const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
  if (bucketDiff !== 0) return bucketDiff;
  if (a.rank !== b.rank) return a.rank - b.rank;
  const aTeam = a.teamNumber ?? Number.MAX_SAFE_INTEGER;
  const bTeam = b.teamNumber ?? Number.MAX_SAFE_INTEGER;
  if (aTeam !== bTeam) return aTeam - bTeam;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortPickEntries<T extends OrderableEntry>(entries: T[]): T[] {
  return [...entries].sort(comparePickEntries);
}

/**
 * Dense 1..n ranks in display order. Ranks in the DB drift (gaps after deletes, ties after an
 * import); normalization is what makes "rank 3" mean the same thing on every device.
 */
export function normalizeRanks<T extends OrderableEntry>(entries: T[]): Array<T & { rank: number }> {
  return sortPickEntries(entries).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export type ReorderRequest = {
  entryId: string;
  /** Zero-based destination in the fully-ordered list. Clamped into range. */
  toIndex: number;
  /** Optional bucket change applied as part of the same move. */
  bucket?: PickBucket;
};

/**
 * Move one entry to a new position (and optionally a new bucket), then renormalize.
 * Returns the whole list because rank is positional: moving one row renumbers its neighbours.
 */
export function applyReorder<T extends OrderableEntry>(
  entries: T[],
  request: ReorderRequest,
): Array<T & { rank: number }> {
  const ordered = sortPickEntries(entries);
  const fromIndex = ordered.findIndex((entry) => entry.id === request.entryId);
  if (fromIndex < 0) return normalizeRanks(entries);

  const moved = { ...ordered[fromIndex]!, bucket: request.bucket ?? ordered[fromIndex]!.bucket };
  const without = ordered.filter((_, index) => index !== fromIndex);
  const target = Math.min(Math.max(Math.trunc(request.toIndex), 0), without.length);
  without.splice(target, 0, moved);

  // Re-sorting here would undo the drag when the bucket differs, so assign ranks positionally
  // inside each bucket and let the bucket order do the coarse grouping.
  const byBucket = new Map<PickBucket, T[]>();
  for (const entry of without) {
    const list = byBucket.get(entry.bucket) ?? [];
    list.push(entry);
    byBucket.set(entry.bucket, list);
  }
  const result: Array<T & { rank: number }> = [];
  let rank = 1;
  for (const bucket of PICK_BUCKETS) {
    for (const entry of byBucket.get(bucket) ?? []) {
      result.push({ ...entry, rank: rank++ });
    }
  }
  return result;
}

/** id -> rank map for the bulk UPDATE in store.reorderEntry. */
export function rankAssignments(entries: Array<{ id: string; rank: number }>): {
  ids: string[];
  ranks: number[];
} {
  return {
    ids: entries.map((entry) => entry.id),
    ranks: entries.map((entry) => entry.rank),
  };
}

export type VoteAggregate = {
  /** Sum of vote weights — the consensus signal shown next to a team. */
  weightedScore: number;
  /** Weight-averaged rank suggestion from voters who gave one; null when nobody did. */
  averageRankSuggestion: number | null;
  voterCount: number;
};

export function aggregateVotes(votes: PickListVote[]): VoteAggregate {
  const usable = votes.filter((vote) => Number.isFinite(vote.weight) && vote.weight > 0);
  const weightedScore = Math.round(usable.reduce((sum, vote) => sum + vote.weight, 0) * 100) / 100;

  const withRank = usable.filter((vote) => vote.rankSuggestion != null);
  const weightSum = withRank.reduce((sum, vote) => sum + vote.weight, 0);
  const averageRankSuggestion =
    withRank.length === 0 || weightSum <= 0
      ? null
      : Math.round(
          (withRank.reduce((sum, vote) => sum + vote.weight * (vote.rankSuggestion as number), 0) /
            weightSum) *
            10,
        ) / 10;

  return {
    weightedScore,
    averageRankSuggestion,
    voterCount: new Set(usable.map((vote) => vote.voterId)).size,
  };
}

export function clampVoteWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(0.1, Math.round(value * 100) / 100));
}

/**
 * Two devices reordering the same list is normal at an event with bad wifi. We take
 * last-write-wins (the move still lands) but never silently: when the caller's revision is stale
 * we return a conflict describing who moved it first, so the UI can say so out loud.
 */
export function detectReorderConflict(input: {
  expectedRevision: number | null | undefined;
  actualRevision: number;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
}): ReorderConflict | null {
  const expected = input.expectedRevision;
  if (expected == null || !Number.isFinite(expected)) return null;
  if (expected >= input.actualRevision) return null;
  const who = input.lastEditedBy?.trim() || "another device";
  return {
    code: "stale_revision",
    message: `${who} reordered this list first. Your move was applied on top of theirs.`,
    lastEditedBy: input.lastEditedBy,
    lastEditedAt: input.lastEditedAt,
    expectedRevision: expected,
    actualRevision: input.actualRevision,
  };
}

export type BucketCount = { bucket: PickBucket; count: number };

export function summarizeBuckets(entries: Array<{ bucket: PickBucket }>): BucketCount[] {
  return PICK_BUCKETS.map((bucket) => ({
    bucket,
    count: entries.filter((entry) => entry.bucket === bucket).length,
  }));
}

export function teamKeyFromNumber(teamNumber: number): string {
  return `frc${Math.trunc(teamNumber)}`;
}

export function teamNumberFromKey(teamKey: string | null | undefined): number | null {
  const match = /^frc(\d{1,6})$/i.exec((teamKey ?? "").trim());
  return match ? Number(match[1]) : null;
}

/** Accepts "254" or "frc254"; returns null for anything else rather than inventing a key. */
export function normalizeTeamKey(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d{1,6}$/.test(trimmed)) return `frc${Number(trimmed)}`;
  if (/^frc\d{1,6}$/i.test(trimmed)) return `frc${Number(trimmed.slice(3))}`;
  return null;
}
