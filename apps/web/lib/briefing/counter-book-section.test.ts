import { describe, expect, it } from "vitest";
import {
  counterBookGaps,
  selectBriefingCounterBooks,
  type CounterBookReportRow,
} from "./counter-book-section";

function row(overrides: Partial<CounterBookReportRow> = {}): CounterBookReportRow {
  return {
    id: "report-1",
    teamKey: "frc254",
    teamNumber: 254,
    eventKey: "2026onto",
    title: "Counter-book — Team 254",
    matchesScouted: 6,
    tendencies: [
      { field: "auto_points", average: 12.5, sampleSize: 6, variability: 0.2 },
      { field: "teleop_points", average: 30, sampleSize: 6, variability: 0.5 },
    ],
    failureTriggers: [{ field: "teleop_points", detail: "Swings hard under defense", variability: 0.5 }],
    counterPlan: "Deny the far feeder station in the last 30 seconds.",
    summary: "Six scouted matches.",
    createdAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectBriefingCounterBooks", () => {
  it("returns nothing when the org has generated no counter-books", () => {
    expect(selectBriefingCounterBooks([], ["frc254", "frc118"])).toEqual([]);
  });

  it("keeps only opponents in this match, in lineup order", () => {
    const reports = selectBriefingCounterBooks(
      [
        row({ id: "a", teamKey: "frc1678", teamNumber: 1678 }),
        row({ id: "b", teamKey: "frc254", teamNumber: 254 }),
        row({ id: "c", teamKey: "frc9999", teamNumber: 9999 }),
      ],
      ["frc254", "frc1678"],
    );
    expect(reports.map((report) => report.teamKey)).toEqual(["frc254", "frc1678"]);
  });

  it("keeps the newest report per opponent (callers pass newest first)", () => {
    const reports = selectBriefingCounterBooks(
      [
        row({ id: "new", createdAt: "2026-03-15T00:00:00.000Z", matchesScouted: 9 }),
        row({ id: "old", createdAt: "2026-03-01T00:00:00.000Z", matchesScouted: 2 }),
      ],
      ["frc254"],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.id).toBe("new");
    expect(reports[0]!.matchesScouted).toBe(9);
  });

  it("sorts tendencies by what the opponent does most and caps the card", () => {
    const reports = selectBriefingCounterBooks(
      [
        row({
          tendencies: [
            { field: "a", average: 1, sampleSize: 3, variability: 0 },
            { field: "b", average: 9, sampleSize: 3, variability: 0 },
            { field: "c", average: 5, sampleSize: 3, variability: 0 },
            { field: "d", average: 7, sampleSize: 3, variability: 0 },
            { field: "e", average: 8, sampleSize: 3, variability: 0 },
          ],
        }),
      ],
      ["frc254"],
    );
    expect(reports[0]!.tendencies.map((t) => t.field)).toEqual(["b", "e", "d", "c"]);
  });

  it("drops malformed tendency rows instead of showing NaN", () => {
    const reports = selectBriefingCounterBooks(
      [
        row({
          tendencies: [
            { field: "", average: 4, sampleSize: 2, variability: 0 },
            { field: "auto_points", average: "not-a-number", sampleSize: 2 },
            { field: "teleop_points", average: 3, sampleSize: 0, variability: 0 },
            { field: "endgame_points", average: 3, sampleSize: 2 },
          ],
          failureTriggers: "nonsense",
        }),
      ],
      ["frc254"],
    );
    expect(reports[0]!.tendencies).toEqual([
      { field: "endgame_points", average: 3, sampleSize: 2, variability: 0 },
    ]);
    expect(reports[0]!.failureTriggers).toEqual([]);
  });

  it("drops a report that carries no tendency, trigger or plan", () => {
    expect(
      selectBriefingCounterBooks(
        [row({ tendencies: [], failureTriggers: [], counterPlan: "   ", summary: "" })],
        ["frc254"],
      ),
    ).toEqual([]);
  });
});

describe("counterBookGaps", () => {
  it("names the opponents still missing a counter-book", () => {
    const reports = selectBriefingCounterBooks([row()], ["frc254", "frc118", "frc1323"]);
    expect(counterBookGaps(reports, ["frc254", "frc118", "frc1323"])).toEqual([
      "frc118",
      "frc1323",
    ]);
  });

  it("is empty when every opponent is covered", () => {
    const reports = selectBriefingCounterBooks([row()], ["frc254"]);
    expect(counterBookGaps(reports, ["frc254"])).toEqual([]);
  });
});
