import { describe, expect, it } from "vitest";
import type { PicklistCollabEntryWithRating } from ".";
import { orderPayload, reorderGroups, sameOrder, type TierGroup } from "./reorder";

function entry(id: string, tier: PicklistCollabEntryWithRating["tier"]): PicklistCollabEntryWithRating {
  return { id, tier, teamNumber: Number(id.replace(/\D/g, "")) || 1 } as PicklistCollabEntryWithRating;
}

const groups = (): TierGroup[] => [
  { tier: "first_pick", entries: [entry("a1", "first_pick"), entry("a2", "first_pick"), entry("a3", "first_pick")] },
  { tier: "second_pick", entries: [entry("b1", "second_pick")] },
  { tier: "unranked", entries: [] },
  { tier: "avoid", entries: [] },
];
const ids = (g: TierGroup[], tier: string) => g.find((group) => group.tier === tier)!.entries.map((e) => e.id);

describe("reorderGroups", () => {
  it("moves an entry down within its tier", () => {
    expect(ids(reorderGroups(groups(), "a1", "first_pick", 1), "first_pick")).toEqual(["a2", "a1", "a3"]);
    expect(ids(reorderGroups(groups(), "a1", "first_pick", 2), "first_pick")).toEqual(["a2", "a3", "a1"]);
  });

  it("moves an entry up within its tier", () => {
    expect(ids(reorderGroups(groups(), "a3", "first_pick", 0), "first_pick")).toEqual(["a3", "a1", "a2"]);
  });

  it("moves an entry to another tier, changing its tier", () => {
    const next = reorderGroups(groups(), "a2", "second_pick", 0);
    expect(ids(next, "first_pick")).toEqual(["a1", "a3"]);
    expect(ids(next, "second_pick")).toEqual(["a2", "b1"]);
    expect(next.find((g) => g.tier === "second_pick")!.entries[0]!.tier).toBe("second_pick");
  });

  it("drops into an empty tier and clamps a slot past the end", () => {
    expect(ids(reorderGroups(groups(), "b1", "avoid", 9), "avoid")).toEqual(["b1"]);
    expect(ids(reorderGroups(groups(), "a1", "second_pick", 99), "second_pick")).toEqual(["b1", "a1"]);
  });

  it("leaves everything alone for an unknown entry", () => {
    const before = groups();
    expect(reorderGroups(before, "zz", "first_pick", 0)).toBe(before);
  });
});

describe("sameOrder and orderPayload", () => {
  it("detects a no-op drop", () => {
    expect(sameOrder(groups(), reorderGroups(groups(), "a2", "first_pick", 1))).toBe(true);
    expect(sameOrder(groups(), reorderGroups(groups(), "a2", "first_pick", 0))).toBe(false);
  });

  it("sends only tiers that have entries, in visible order", () => {
    expect(orderPayload(groups())).toEqual({
      action: "set-order",
      order: [
        { tier: "first_pick", entryIds: ["a1", "a2", "a3"] },
        { tier: "second_pick", entryIds: ["b1"] },
      ],
    });
  });
});
