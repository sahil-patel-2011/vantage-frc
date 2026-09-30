import type { PicklistCollabEntryWithRating } from ".";
import type { PicklistCollabTier } from "./types";

export type TierGroup = { tier: PicklistCollabTier; entries: PicklistCollabEntryWithRating[] };

/**
 * The tiers after moving one entry to `index` in `tier`. `index` counts the entries that stay,
 * so 0 is the top of the tier and `entries.length` (without the moved one) is the bottom. The
 * same rule serves a drag, an arrow key, and a move to another tier.
 */
export function reorderGroups(groups: TierGroup[], id: string, tier: PicklistCollabTier, index: number): TierGroup[] {
  let moving: PicklistCollabEntryWithRating | undefined;
  const others = groups.map((group) => ({
    tier: group.tier,
    entries: group.entries.filter((entry) => {
      if (entry.id !== id) return true;
      moving = entry;
      return false;
    }),
  }));
  const moved = moving as PicklistCollabEntryWithRating | undefined;
  if (!moved) return groups;
  return others.map((group) => {
    if (group.tier !== tier) return group;
    const entries = [...group.entries];
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, { ...moved, tier });
    return { tier: group.tier, entries };
  });
}

export function sameOrder(a: TierGroup[], b: TierGroup[]): boolean {
  const flat = (groups: TierGroup[]) => groups.map((group) => `${group.tier}:${group.entries.map((entry) => entry.id).join(",")}`).join("|");
  return flat(a) === flat(b);
}

/** What the server saves: one ordered list of entry ids per tier that has entries. */
export function orderPayload(groups: TierGroup[]) {
  return {
    action: "set-order",
    order: groups
      .map((group) => ({ tier: group.tier, entryIds: group.entries.map((entry) => entry.id) }))
      .filter((group) => group.entryIds.length > 0),
  };
}
