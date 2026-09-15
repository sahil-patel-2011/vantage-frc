import { describe, expect, it } from "vitest";
import {
  buildLookupCards,
  contributionShare,
  fieldCompare,
  fieldStatsFromEventRows,
  fieldStatsFromScoutRows,
  formatLookupValue,
  scoutAveragesFromPayloads,
  scoutMetricsFromPayload,
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
    expect(cards.find((card) => card.id === "defenseEffectiveness")?.value).toBe(3);
    expect(formatLookupValue(null)).toBe("—");
  });
});

describe("scoutMetricsFromPayload", () => {
  it("derives fuel totals from published match fields and leaves rates blank without a timer", () => {
    const metrics = scoutMetricsFromPayload({
      auto_fuel: 3,
      teleop_fuel: 9,
      fuel_passed: 6,
      notes: "Lost comms late",
    });
    expect(metrics.estimatedTotalFuelScored).toBe(12);
    expect(metrics.totalFuelFed).toBe(6);
    expect(metrics.totalFuelThroughput).toBe(18);
    expect(metrics.scoringRate).toBeNull();
    expect(metrics.feedingRate).toBeNull();
    expect(metrics.driverAbility).toBeNull();
  });

  it("uses stored duration for a scoring rate and maps qualitative answers", () => {
    const metrics = scoutMetricsFromPayload({
      auto_fuel: 2,
      teleop_fuel: 8,
      scoring_time: 10,
      driver_skill: "great",
      auto_climb: "succeeded",
      disabled: false,
    });
    expect(metrics.scoringRate).toBe(1);
    expect(metrics.driverAbility).toBe(4);
    expect(metrics.autoClimb).toBe(1);
    expect(metrics.reliability).toBe(1);
  });

  it("stays blank when the payload has no scout answers", () => {
    expect(scoutMetricsFromPayload({})).toEqual(
      expect.objectContaining({
        estimatedTotalFuelScored: null,
        driverAbility: null,
        reliability: null,
      }),
    );
  });
});

describe("fieldStatsFromScoutRows", () => {
  it("compares a team to other scouted robots at this event", () => {
    const rows = [
      scoutAveragesFromPayloads("frc1", [{ auto_fuel: 2, teleop_fuel: 4 }])!,
      scoutAveragesFromPayloads("frc2", [{ auto_fuel: 6, teleop_fuel: 10 }])!,
    ];
    const stats = fieldStatsFromScoutRows(rows);
    expect(stats.estimatedTotalFuelScored?.n).toBe(2);
    expect(stats.estimatedTotalFuelScored?.mean).toBe(11);
  });
});
