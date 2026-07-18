import { describe, expect, it } from "vitest";
import {
  buildChoseScoutResolution,
  buildDismissResolution,
  formatConflictValue,
  resolutionSummary,
  validateResolution,
  zipCandidates,
} from "../src/resolution";

describe("disagreement resolution", () => {
  it("builds a chose-scout resolution and validates entry membership", () => {
    const resolution = buildChoseScoutResolution({
      entryId: "entry-a",
      scoutUserId: "user-a",
      scoutName: "Alex",
      value: 4,
      note: "  TBA confirmed  ",
    });
    expect(resolution).toMatchObject({
      outcome: "chose_scout",
      winningEntryId: "entry-a",
      winningScoutName: "Alex",
      chosenValue: 4,
      note: "TBA confirmed",
    });
    expect(validateResolution(resolution, ["entry-a", "entry-b"])).toBeNull();
    expect(validateResolution(resolution, ["entry-b"])).toBe(
      "Winning entry is not part of this disagreement",
    );
  });

  it("summarizes dismiss and winner outcomes for the audit UI", () => {
    expect(resolutionSummary(buildDismissResolution({ note: "noise" }))).toBe(
      "Dismissed — noise",
    );
    expect(
      resolutionSummary(
        buildChoseScoutResolution({
          entryId: "e1",
          scoutUserId: "u1",
          scoutName: "Sam",
          value: "high",
        }),
      ),
    ).toBe("Sam was right (high)");
  });

  it("zips stored values with scout identity for the picker", () => {
    const candidates = zipCandidates(
      ["e1", "e2"],
      [2, 5],
      [
        { entryId: "e1", scoutUserId: "u1", scoutName: "Pat" },
        { entryId: "e2", scoutUserId: "u2", scoutName: "Riley" },
      ],
    );
    expect(candidates).toEqual([
      { entryId: "e1", scoutUserId: "u1", scoutName: "Pat", value: 2 },
      { entryId: "e2", scoutUserId: "u2", scoutName: "Riley", value: 5 },
    ]);
    expect(formatConflictValue({ nested: true })).toBe('{"nested":true}');
  });
});
