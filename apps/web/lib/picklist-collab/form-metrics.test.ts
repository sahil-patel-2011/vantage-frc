import { describe, expect, it } from "vitest";
import { fieldStatsFromRows, picklistMetricLabel, rankByWeightedZScores } from "@vantage/prediction-strategy";
import { formMetricRows, mergeFormMetrics } from "./form-metrics";

const entries = [
  { teamKey: "frc1", payload: { teleopCycles: 12, fouls: 0, notes: "fast", matchNumber: 3 } },
  { teamKey: "frc1", payload: { teleopCycles: 10, fouls: 2 } },
  { teamKey: "frc2", payload: { teleopCycles: 6, fouls: 0 } },
  { teamKey: "frc3", payload: { teleopCycles: 8, fouls: 4, endgame: "climb" } },
];

describe("form metrics", () => {
  it("averages every number the form collects, per team, skipping bookkeeping and text", () => {
    const rows = formMetricRows(entries);
    const one = rows.find((row) => row.teamKey === "frc1");
    expect(one?.values["form:teleopCycles"]).toBe(11);
    expect(one?.values).not.toHaveProperty("form:matchNumber");
    expect(one?.values).not.toHaveProperty("form:notes");
  });

  it("negates less-is-better fields and names them so", () => {
    const rows = formMetricRows(entries);
    expect(rows.find((row) => row.teamKey === "frc3")?.values["form:fouls"]).toBe(-4);
    expect(picklistMetricLabel("form:fouls")).toBe("Fewer fouls");
    expect(picklistMetricLabel("form:teleopCycles")).toBe("Teleop cycles");
  });

  it("gets field stats and ranks on a form field like any built-in metric", () => {
    const rows = formMetricRows(entries);
    const stats = fieldStatsFromRows(rows);
    expect(stats["form:teleopCycles"]?.n).toBe(3);
    const ranked = rankByWeightedZScores(rows, [{ id: "form:teleopCycles", weight: 1 }], stats);
    expect(ranked.map((row) => row.teamKey)).toEqual(["frc1", "frc3", "frc2"]);
    // Weighting "fewer fouls" puts the clean robot first.
    const clean = rankByWeightedZScores(rows, [{ id: "form:fouls", weight: 1 }], stats);
    expect(clean[0]?.teamKey).toBe("frc2");
  });

  it("adds form values without overwriting existing ones", () => {
    const merged = mergeFormMetrics(
      [{ teamKey: "frc1", values: { totalPoints: 50 } }],
      [{ teamKey: "frc1", values: { "form:teleopCycles": 11 } }, { teamKey: "frc9", values: { "form:teleopCycles": 4 } }],
    );
    expect(merged.find((row) => row.teamKey === "frc1")?.values).toEqual({ totalPoints: 50, "form:teleopCycles": 11 });
    expect(merged.some((row) => row.teamKey === "frc9")).toBe(true);
  });
});
