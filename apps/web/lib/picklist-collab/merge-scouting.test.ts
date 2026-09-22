import { describe, expect, it } from "vitest";
import { mergeScoutingIntoEventRows } from "./compute-picklist-collab";

describe("mergeScoutingIntoEventRows", () => {
  it("adds what only our scouts know to the synced ratings", () => {
    const merged = mergeScoutingIntoEventRows(
      [{ teamKey: "frc254", values: { totalPoints: 59, autoPoints: 10 } }],
      [{ teamKey: "frc254", values: { totalPoints: 54, reliability: 0.93, consistency: 0.7 } }],
    );
    // Ratings keep their own scale; scouting fills reliability and consistency.
    expect(merged).toEqual([
      { teamKey: "frc254", values: { totalPoints: 59, autoPoints: 10, reliability: 0.93, consistency: 0.7 } },
    ]);
  });

  it("lets scouting stand in for points only when nobody at the event is rated", () => {
    const merged = mergeScoutingIntoEventRows([], [{ teamKey: "frc1", values: { totalPoints: 40, reliability: 1 } }]);
    expect(merged[0]?.values).toEqual({ reliability: 1, totalPoints: 40 });
  });

  it("keeps a scouted team that has no rating, without inventing points for it", () => {
    const merged = mergeScoutingIntoEventRows(
      [{ teamKey: "frc254", values: { totalPoints: 59 } }],
      [{ teamKey: "frc9999", values: { totalPoints: 30, reliability: 0.5 } }],
    );
    expect(merged.find((row) => row.teamKey === "frc9999")?.values).toEqual({ reliability: 0.5 });
  });
});
