import { describe, expect, it } from "vitest";
import { defaultMatchup, groupAllianceSlots } from "./alliances";

describe("groupAllianceSlots", () => {
  it("orders each alliance captain, first pick, second pick, and seeds best first", () => {
    const alliances = groupAllianceSlots([
      { allianceSeed: 2, pickSlot: "second", teamKey: "frc3" },
      { allianceSeed: 1, pickSlot: "first", teamKey: "frc254" },
      { allianceSeed: 2, pickSlot: "captain", teamKey: "frc1" },
      { allianceSeed: 1, pickSlot: "captain", teamKey: "frc1678" },
      { allianceSeed: 2, pickSlot: "first", teamKey: "FRC2" },
    ]);
    expect(alliances).toEqual([
      { seed: 1, teamKeys: ["frc1678", "frc254"] },
      { seed: 2, teamKeys: ["frc1", "frc2", "frc3"] },
    ]);
  });

  it("skips empty slots, bad keys, out-of-range seeds and the board's join row with no slot", () => {
    expect(
      groupAllianceSlots([
        { allianceSeed: null, pickSlot: null, teamKey: null },
        { allianceSeed: 3, pickSlot: "captain", teamKey: null },
        { allianceSeed: 3, pickSlot: "first", teamKey: "254" },
        { allianceSeed: 9, pickSlot: "captain", teamKey: "frc9" },
        { allianceSeed: 4, pickSlot: "captain", teamKey: "frc4" },
        { allianceSeed: 4, pickSlot: "first", teamKey: "frc4" },
      ]),
    ).toEqual([{ seed: 4, teamKeys: ["frc4"] }]);
  });
});

describe("defaultMatchup", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ seed: i + 1, teamKeys: [`frc${100 + i}`] }));

  it("puts our alliance against its first-round opponent (1–8, 3–6)", () => {
    expect(defaultMatchup(eight, "frc102")).toEqual([3, 6]);
    expect(defaultMatchup(eight, "frc100")).toEqual([1, 8]);
  });

  it("falls back to another alliance when the bracket opponent is not on the board", () => {
    expect(defaultMatchup(eight.slice(0, 4), "frc101")).toEqual([2, 1]);
  });

  it("uses the top two seeds when we are not on an alliance, and nothing with one alliance", () => {
    expect(defaultMatchup(eight, "frc9999")).toEqual([1, 2]);
    expect(defaultMatchup(eight, null)).toEqual([1, 2]);
    expect(defaultMatchup(eight.slice(0, 1), "frc100")).toBeNull();
  });
});
