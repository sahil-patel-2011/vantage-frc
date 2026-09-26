import { describe, expect, it } from "vitest";
import type { FormulaExpression } from "@vantage/scouting";
import {
  compareMatchOrder,
  isScoutedRatingsUnavailable,
  matchRowTotal,
  onePerMatch,
  scoutedRowsFromEntries,
  type OrgValueFormula,
  type ScoutEntryRow,
} from "./scouted-ratings";

const field = (name: string): FormulaExpression => ({ op: "field", field: name });
const times = (name: string, by: number): FormulaExpression => ({
  op: "multiply",
  args: [field(name), { op: "constant", value: by }],
});

const AUTO: OrgValueFormula = { name: "Auto", expression: times("auto_fuel", 4) };
const TELEOP: OrgValueFormula = { name: "Teleop", expression: times("teleop_fuel", 2) };
const TOTAL: OrgValueFormula = {
  name: "Total points",
  expression: { op: "add", args: [times("auto_fuel", 4), times("teleop_fuel", 2)] },
};

function entry(over: Partial<ScoutEntryRow> & { teamKey: string; matchKey: string }): ScoutEntryRow {
  return { payload: {}, ...over };
}

/**
 * Enough teams and matches for a rating to stand on its own.
 *
 * Auto is held constant so the total is strictly increasing in `t`. With auto
 * varying, `auto*4 + teleop*2` ties teams 405 and 407 at 28 apiece and the
 * ranking assertion below becomes a coin flip on the tiebreak.
 */
function eventEntries(): ScoutEntryRow[] {
  const rows: ScoutEntryRow[] = [];
  for (let t = 0; t < 8; t += 1) {
    for (let m = 0; m < 4; m += 1) {
      rows.push(
        entry({
          teamKey: `frc${400 + t}`,
          matchKey: `qm${m}`,
          payload: { auto_fuel: 2, teleop_fuel: 5 + t },
        }),
      );
    }
  }
  return rows;
}

describe("scoutedRowsFromEntries", () => {
  it("asks for a formula instead of guessing what a game action is worth", () => {
    const result = scoutedRowsFromEntries(eventEntries(), []);

    expect(isScoutedRatingsUnavailable(result)).toBe(true);
    if (!isScoutedRatingsUnavailable(result)) return;
    expect(result.needsFormula).toBe(true);
    expect(result.reason).toContain("Scouting formulas");
  });

  it("scores entries with the team's own phase formulas", () => {
    const result = scoutedRowsFromEntries(
      [
        entry({ teamKey: "frc1", matchKey: "qm1", payload: { auto_fuel: 3, teleop_fuel: 10 } }),
        entry({ teamKey: "frc1", matchKey: "qm2", payload: { auto_fuel: 1, teleop_fuel: 10 } }),
      ],
      [AUTO, TELEOP],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basis).toBe("phase");
    const rating = result.ratings[0]!;
    expect(rating.meanAuto).toBe(8); // (12 + 4) / 2
    expect(rating.meanTeleop).toBe(20);
    expect(rating.meanTotal).toBe(28);
  });

  it("accepts a single total formula when there is no phase split", () => {
    const result = scoutedRowsFromEntries(
      [entry({ teamKey: "frc1", matchKey: "qm1", payload: { auto_fuel: 2, teleop_fuel: 6 } })],
      [TOTAL],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basis).toBe("total");
    expect(result.ratings[0]!.meanTotal).toBe(20);
  });

  it("matches formula names loosely so casing and spacing do not matter", () => {
    const result = scoutedRowsFromEntries(
      [entry({ teamKey: "frc1", matchKey: "qm1", payload: { auto_fuel: 1, teleop_fuel: 1 } })],
      [{ name: "  TOTAL_POINTS  ", expression: TOTAL.expression }],
    );
    expect(result.ok).toBe(true);
  });

  it("carries a disabled robot through as a real zero", () => {
    const result = scoutedRowsFromEntries(
      [
        entry({ teamKey: "frc1", matchKey: "qm1", payload: { teleop_fuel: 10 } }),
        entry({ teamKey: "frc1", matchKey: "qm2", payload: { disabled: true, teleop_fuel: 0 } }),
      ],
      [TELEOP],
    );

    if (!result.ok) throw new Error("expected ratings");
    expect(result.ratings[0]!.disabledRate).toBe(0.5);
    expect(result.ratings[0]!.meanTotal).toBe(10);
  });

  it("reads the season's climb field without being told which one it is", () => {
    const result = scoutedRowsFromEntries(
      [
        entry({ teamKey: "frc1", matchKey: "qm1", payload: { tower_level: "L2", teleop_fuel: 1 } }),
        entry({ teamKey: "frc1", matchKey: "qm2", payload: { tower_level: "none", teleop_fuel: 1 } }),
      ],
      [TELEOP],
    );

    if (!result.ok) throw new Error("expected ratings");
    expect(result.ratings[0]!.climbRate).toBe(0.5);
  });

  it("reports no climb rate when the form has no climb field", () => {
    const result = scoutedRowsFromEntries(
      [entry({ teamKey: "frc1", matchKey: "qm1", payload: { teleop_fuel: 1 } })],
      [TELEOP],
    );

    if (!result.ok) throw new Error("expected ratings");
    expect(result.ratings[0]!.climbRate).toBeNull();
  });

  it("rates a whole event's worth of entries", () => {
    const result = scoutedRowsFromEntries(eventEntries(), [AUTO, TELEOP]);

    if (!result.ok) throw new Error("expected ratings");
    expect(result.ratings).toHaveLength(8);
    expect(result.ratings[0]!.teamKey).toBe("frc407");
    expect(result.ratings.every((rating) => rating.matches === 4)).toBe(true);
    // Ranked strongest first, with no ties to break.
    const totals = result.ratings.map((rating) => rating.shrunkTotal);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it("treats a missing payload as an empty one rather than throwing", () => {
    const result = scoutedRowsFromEntries(
      [{ teamKey: "frc1", matchKey: "qm1", payload: undefined as never }],
      [TELEOP],
    );
    expect(result.ok).toBe(true);
  });
});

describe("points the scouts recorded themselves", () => {
  it("uses a recorded total when there is no formula, and says nothing is guessed", () => {
    const result = scoutedRowsFromEntries(
      [
        entry({ teamKey: "frc1", matchKey: "qm1", payload: { totalPoints: 59, autoPoints: 10, brokeDown: "no" } }),
        entry({ teamKey: "frc1", matchKey: "qm2", payload: { totalPoints: 12, autoPoints: 0, brokeDown: "yes" } }),
      ],
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basis).toBe("total");
    expect(result.rows[0]).toMatchObject({ auto: 10, teleop: 49, disabled: false });
    // "yes" is a breakdown; it used to be read only when the answer was "true".
    expect(result.rows[1]).toMatchObject({ disabled: true });
  });

  it("still asks for a formula when the form records no points at all", () => {
    const result = scoutedRowsFromEntries(eventEntries(), []);
    expect(isScoutedRatingsUnavailable(result)).toBe(true);
  });

  it("does not count parking as a climb", () => {
    const result = scoutedRowsFromEntries(
      [
        entry({ teamKey: "frc1", matchKey: "qm1", payload: { totalPoints: 40, endgame: "park" } }),
        entry({ teamKey: "frc1", matchKey: "qm2", payload: { totalPoints: 50, endgame: "climb" } }),
      ],
      [],
    );
    if (!result.ok) throw new Error("expected rows");
    expect(result.rows.map((row) => row.climbed)).toEqual([false, true]);
  });
});

describe("onePerMatch", () => {
  it("puts matches in match order, not text order", () => {
    const rows = onePerMatch([
      { teamKey: "frc118", matchKey: "e_qm12", teleop: 12 },
      { teamKey: "frc118", matchKey: "e_qm25", teleop: 25 },
      { teamKey: "frc118", matchKey: "e_qm4", teleop: 4 },
      { teamKey: "frc118", matchKey: "e_sf1m1", teleop: 50 },
    ]);
    expect(rows.map((row) => row.matchKey)).toEqual(["e_qm4", "e_qm12", "e_qm25", "e_sf1m1"]);
    expect(compareMatchOrder("e_qm2", "e_qm10")).toBeLessThan(0);
  });

  it("counts two scouts on one robot once, averaged", () => {
    const [row] = onePerMatch([
      { teamKey: "frc1", matchKey: "e_qm1", auto: 4, teleop: 4 },
      { teamKey: "frc1", matchKey: "e_qm1", auto: 6, teleop: 10, defense: true },
    ]);
    expect(row).toMatchObject({ auto: 5, teleop: 7, disabled: false, defense: true });
    expect(matchRowTotal(row!)).toBe(12);
  });

  it("scores a disabled robot 0 when at least half the scouts said so", () => {
    const [row] = onePerMatch([
      { teamKey: "frc1", matchKey: "e_qm1", teleop: 20, disabled: true },
      { teamKey: "frc1", matchKey: "e_qm1", teleop: 8 },
    ]);
    expect(row?.disabled).toBe(true);
    expect(matchRowTotal(row!)).toBe(0);
    expect(matchRowTotal({ teamKey: "frc1", matchKey: "e_qm2" })).toBeNull();
  });
});
