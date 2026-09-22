import { describe, expect, it } from "vitest";
import { buildScoutBreakdown, fieldLabel, matchKeyLabel, matchSortValue } from "./scout-breakdown";

const rows = [
  { matchKey: "2026gacmp_qm11", payload: { autoPoints: 0, totalPoints: 12, endgame: "none", brokeDown: "yes", notes: "Stopped moving mid-match." } },
  { matchKey: "2026gacmp_qm1", payload: { autoPoints: 10, totalPoints: 59, endgame: "climb", brokeDown: "no", notes: "" } },
  { matchKey: "2026gacmp_qm3", payload: { autoPoints: 12, totalPoints: 62, endgame: "climb", brokeDown: "no", notes: "" } },
  { matchKey: "2026gacmp_qm6", payload: { autoPoints: 8, totalPoints: 50, endgame: "park", brokeDown: "no", notes: "" } },
];

describe("matchKeyLabel", () => {
  it("names matches the way a drive team says them", () => {
    expect(matchKeyLabel("2026gacmp_qm6")).toBe("Q6");
    expect(matchKeyLabel("2026gacmp_sf2m1")).toBe("SF2-1");
    expect(matchKeyLabel("2026gacmp_f1m2")).toBe("F-2");
    expect(matchKeyLabel(null)).toBe("Pit");
    expect(matchKeyLabel("custom")).toBe("custom");
  });

  it("sorts quals before playoffs before finals", () => {
    const keys = ["x_f1m1", "x_qm10", "x_sf1m1", "x_qm2"];
    expect([...keys].sort((a, b) => matchSortValue(a) - matchSortValue(b))).toEqual([
      "x_qm2",
      "x_qm10",
      "x_sf1m1",
      "x_f1m1",
    ]);
  });
});

describe("buildScoutBreakdown", () => {
  const breakdown = buildScoutBreakdown(rows);

  it("reads the fields the form actually collects, in match order", () => {
    const total = breakdown.fields.find((field) => field.key === "totalPoints");
    expect(total?.kind).toBe("number");
    if (total?.kind !== "number") throw new Error("expected number");
    expect(total.series.map((point) => point.match)).toEqual(["Q1", "Q3", "Q6", "Q11"]);
    expect(total.mean).toBe(45.8);
    expect(total.min).toBe(12);
    expect(total.max).toBe(62);
    expect(total.sparkline).toMatch(/^M/);
    expect(total.recentDelta).not.toBeNull();
  });

  it("turns yes/no answers into a rate and knows a breakdown is bad news", () => {
    const broke = breakdown.fields.find((field) => field.key === "brokeDown");
    expect(broke).toMatchObject({ kind: "rate", yes: 1, total: 4, rate: 0.25, yesIsBad: true });
  });

  it("splits short picks and keeps free text as notes", () => {
    const endgame = breakdown.fields.find((field) => field.key === "endgame");
    expect(endgame?.kind).toBe("split");
    if (endgame?.kind !== "split") throw new Error("expected split");
    expect(endgame.options[0]).toEqual({ value: "climb", count: 2, share: 0.5 });
    expect(breakdown.notes).toEqual([{ match: "Q11", text: "Stopped moving mid-match." }]);
    expect(breakdown.fields.some((field) => field.key === "notes")).toBe(false);
  });

  it("shows nothing it was not given", () => {
    expect(buildScoutBreakdown([])).toEqual({ matches: 0, fields: [], notes: [] });
    const sparse = buildScoutBreakdown([{ matchKey: "x_qm1", payload: { totalPoints: 40 } }]);
    const total = sparse.fields[0];
    if (total?.kind !== "number") throw new Error("expected number");
    expect(total.sparkline).toBeNull();
    expect(total.recentDelta).toBeNull();
  });

  it("puts the score first and knows fewer fouls is better", () => {
    const withFouls = buildScoutBreakdown([
      { matchKey: "x_qm1", payload: { fouls: 2, totalPoints: 40, autoPoints: 8 } },
      { matchKey: "x_qm2", payload: { fouls: 0, totalPoints: 44, autoPoints: 9 } },
    ]);
    expect(withFouls.fields.map((field) => field.key)).toEqual(["totalPoints", "autoPoints", "fouls"]);
    const fouls = withFouls.fields.find((field) => field.key === "fouls");
    expect(fouls).toMatchObject({ kind: "number", lowerIsBetter: true });
  });

  it("labels keys in plain words", () => {
    expect(fieldLabel("teleopCycles")).toBe("Teleop cycles");
    expect(fieldLabel("auto_climb")).toBe("Auto climb");
  });
});
