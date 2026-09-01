import { describe, expect, it } from "vitest";
import { selectBriefingWatchNotes, type WatchlistEntryRow } from "./watchlist-section";

function row(overrides: Partial<WatchlistEntryRow> = {}): WatchlistEntryRow {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    note: "Cycles the far feeder; bump them off it.",
    createdAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectBriefingWatchNotes", () => {
  it("returns nothing when the org has no watchlist notes", () => {
    expect(selectBriefingWatchNotes([], ["frc254", "frc118"])).toEqual([]);
  });

  it("includes notes only for opponents in this match", () => {
    const notes = selectBriefingWatchNotes(
      [
        row({ teamKey: "frc254", note: "Watch 254 auto" }),
        row({ teamKey: "frc9999", note: "Not in this match" }),
        row({ teamKey: "frc118", note: "Slow climb" }),
      ],
      ["frc254", "frc118"],
    );
    expect(notes.map((note) => note.teamKey)).toEqual(["frc254", "frc118"]);
    expect(notes.map((note) => note.note)).toEqual(["Watch 254 auto", "Slow climb"]);
  });

  it("drops empty / whitespace notes instead of inventing threats", () => {
    expect(
      selectBriefingWatchNotes(
        [row({ note: "   " }), row({ note: null }), row({ note: "Real note" })],
        ["frc254"],
      ),
    ).toEqual([
      {
        teamKey: "frc254",
        teamNumber: 254,
        note: "Real note",
        createdAt: "2026-03-14T12:00:00.000Z",
      },
    ]);
  });

  it("returns nothing when the match has no opponents", () => {
    expect(selectBriefingWatchNotes([row()], [])).toEqual([]);
  });
});
