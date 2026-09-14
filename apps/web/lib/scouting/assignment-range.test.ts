import { describe, expect, it } from "vitest";
import {
  compactAssignments,
  expandAssignmentRange,
  parseMatchKey,
  rangeLabel,
  uniqueMatchKeys,
} from "./assignment-range";

const KEYS = [
  "2026casj_qm1",
  "2026casj_qm2",
  "2026casj_qm3",
  "2026casj_qm4",
  "2026casj_qm10",
  "2026casj_sf1m1",
  "2026txho_qm1",
];

describe("parseMatchKey", () => {
  it("reads quals and playoff sets without inventing numbers", () => {
    expect(parseMatchKey("2026casj_qm12")).toMatchObject({
      eventKey: "2026casj",
      compLevel: "qm",
      matchNumber: 12,
    });
    expect(parseMatchKey("2026casj_sf2m1")).toMatchObject({
      compLevel: "sf",
      setNumber: 2,
      matchNumber: 1,
    });
    expect(parseMatchKey("not-a-match")).toBeNull();
    expect(parseMatchKey("")).toBeNull();
  });
});

describe("expandAssignmentRange", () => {
  it("fills only official keys between first and last", () => {
    const result = expandAssignmentRange({
      firstMatchKey: "2026casj_qm2",
      lastMatchKey: "2026casj_qm4",
      teamKey: "254",
      matchKeys: KEYS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.map((slot) => slot.matchKey)).toEqual([
      "2026casj_qm2",
      "2026casj_qm3",
      "2026casj_qm4",
    ]);
    expect(result.slots[0]?.teamKey).toBe("frc254");
  });

  it("does not invent missing quals between 4 and 10", () => {
    const result = expandAssignmentRange({
      firstMatchKey: "2026casj_qm4",
      lastMatchKey: "2026casj_qm10",
      teamKey: "frc1678",
      matchKeys: KEYS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.map((slot) => slot.matchKey)).toEqual(["2026casj_qm4", "2026casj_qm10"]);
  });

  it("keeps playoffs out unless the lead turns quals-only off", () => {
    const quals = expandAssignmentRange({
      firstMatchKey: "2026casj_qm10",
      lastMatchKey: "2026casj_sf1m1",
      teamKey: "frc254",
      matchKeys: KEYS,
    });
    expect(quals.ok).toBe(true);
    if (quals.ok) expect(quals.slots.map((slot) => slot.matchKey)).toEqual(["2026casj_qm10"]);

    const all = expandAssignmentRange({
      firstMatchKey: "2026casj_qm10",
      lastMatchKey: "2026casj_sf1m1",
      teamKey: "frc254",
      matchKeys: KEYS,
      qualsOnly: false,
    });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.slots.map((slot) => slot.matchKey)).toEqual(["2026casj_qm10", "2026casj_sf1m1"]);
  });

  it("refuses a backwards range and a mixed-event pair", () => {
    expect(
      expandAssignmentRange({
        firstMatchKey: "2026casj_qm4",
        lastMatchKey: "2026casj_qm1",
        teamKey: "frc1",
        matchKeys: KEYS,
      }).error,
    ).toMatch(/before/);
    expect(
      expandAssignmentRange({
        firstMatchKey: "2026casj_qm1",
        lastMatchKey: "2026txho_qm1",
        teamKey: "frc1",
        matchKeys: KEYS,
      }).error,
    ).toMatch(/same event/);
  });
});

describe("compactAssignments", () => {
  it("joins adjacent quals and splits a hole", () => {
    const ranges = compactAssignments([
      { userId: "u1", teamKey: "frc254", matchKey: "2026casj_qm1" },
      { userId: "u1", teamKey: "frc254", matchKey: "2026casj_qm2" },
      { userId: "u1", teamKey: "frc254", matchKey: "2026casj_qm4" },
    ]);
    expect(ranges).toHaveLength(2);
    expect(rangeLabel(ranges[0]!)).toBe("2026casj_qm1 → 2026casj_qm2");
    expect(ranges[1]?.matchCount).toBe(1);
  });
});

describe("uniqueMatchKeys", () => {
  it("sorts schedule order and drops duplicates", () => {
    expect(uniqueMatchKeys([{ matchKey: "2026casj_qm10" }, { matchKey: "2026casj_qm2" }, { matchKey: "2026casj_qm2" }])).toEqual([
      "2026casj_qm2",
      "2026casj_qm10",
    ]);
  });
});
