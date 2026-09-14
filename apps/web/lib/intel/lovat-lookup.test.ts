import { describe, expect, it } from "vitest";
import {
  buildLookupCards,
  contributionShare,
  fieldCompare,
  fieldStatsFromEventRows,
  formatLookupValue,
  scoutAveragesFromPayloads,
  sparklinePath,
  type EventRatingRow,
} from "./lovat-lookup";

const field: EventRatingRow[] = [
  { teamKey: "frc1", epaTotal: 20, epaAuto: 4, epaTeleop: 12, epaEndgame: 4, rank: 12, wins: 4, opr: 18, dpr: 10, ccwm: 8 },
  { teamKey: "frc2", epaTotal: 40, epaAuto: 8, epaTeleop: 24, epaEndgame: 8, rank: 4, wins: 8, opr: 36, dpr: 8, ccwm: 16 },
  { teamKey: "frc3", epaTotal: 60, epaAuto: 12, epaTeleop: 36, epaEndgame: 12, rank: 1, wins: 10, opr: 50, dpr: 6, ccwm: 22 },
];

describe("sparklinePath", () => {
  it("needs two real points before drawing a trend", () => {
    expect(sparklinePath([10])).toBeNull();
    expect(sparklinePath([10, null, 20])).toContain("M");
    expect(sparklinePath([10, 20])).toMatch(/^M/);
  });
});

describe("fieldCompare", () => {
  it("stays unknown when the event has no spread yet", () => {
    expect(fieldCompare(40, null, null).tone).toBe("unknown");
  });

  it("calls a small gap near this event and a clear lead above", () => {
    expect(fieldCompare(41, 40, 10).tone).toBe("near");
    expect(fieldCompare(60, 40, 10).tone).toBe("above");
    expect(fieldCompare(20, 40, 10).tone).toBe("below");
  });

  it("inverts rank so a lower number is above this event", () => {
    expect(fieldCompare(1, 8, 4, true).tone).toBe("above");
  });
});

describe("contributionShare", () => {
  it("skips a zero or missing field average instead of inventing 100%", () => {
    expect(contributionShare(40, 0)).toBeNull();
    expect(contributionShare(40, 40)).toBe(1);
    expect(contributionShare(60, 40)).toBe(1.5);
  });
});

describe("buildLookupCards", () => {
  it("fills event ratings and leaves scout metrics blank", () => {
    const stats = fieldStatsFromEventRows(field);
    const cards = buildLookupCards({
      teamKey: "frc3",
      event: field[2]!,
      field: stats,
      history: [20, 40, 60],
    });
    const total = cards.find((card) => card.id === "totalPoints");
    const driver = cards.find((card) => card.id === "driverAbility");
    expect(total?.display).toBe("60");
    expect(total?.compare.tone).toBe("above");
    expect(total?.sparkline).toMatch(/^M/);
    expect(driver?.display).toBe("—");
    expect(driver?.detail).toMatch(/Needs setup/);
  });

  it("uses scout averages only when the payloads have real numbers", () => {
    const scout = scoutAveragesFromPayloads("frc3", [{ driverAbility: 4 }, { driverAbility: 6, defense: 3 }]);
    const cards = buildLookupCards({
      teamKey: "frc3",
      event: field[2]!,
      field: fieldStatsFromEventRows(field),
      scout,
    });
    expect(cards.find((card) => card.id === "driverAbility")?.value).toBe(5);
    expect(formatLookupValue(null)).toBe("—");
  });
});
