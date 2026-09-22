import { describe, expect, it } from "vitest";
import {
  buildLookupCards,
  contributionShare,
  fieldCompare,
  fieldPercentile,
  fieldStatsFromEventRows,
  formatLookupValue,
  ordinalPercentile,
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

describe("fieldPercentile", () => {
  it("puts the event average at the middle of the field", () => {
    expect(fieldPercentile(0)).toBeCloseTo(0.5, 5);
  });

  it("reads higher for a better z and lower for a worse one", () => {
    const strong = fieldPercentile(1.2)!;
    const weak = fieldPercentile(-1.2)!;
    expect(strong).toBeGreaterThan(0.85);
    expect(weak).toBeLessThan(0.15);
    // fieldCompare already flips rank/DPR so higher z is better; the bar must
    // not invert a second time or a rank-1 team would render at the bottom.
    expect(strong + weak).toBeCloseTo(1, 5);
  });

  it("stays inside the track and refuses a field it cannot measure", () => {
    expect(fieldPercentile(40)).toBeLessThanOrEqual(1);
    expect(fieldPercentile(-40)).toBeGreaterThanOrEqual(0);
    // One team at an event has no field to sit in.
    expect(fieldPercentile(null)).toBeNull();
    expect(fieldPercentile(Number.NaN)).toBeNull();
  });

  it("gives a rank-1 team a top percentile, not a bottom one", () => {
    const stats = fieldStatsFromEventRows(field);
    const compare = fieldCompare(1, stats.rank?.mean ?? null, stats.rank?.std ?? null, true);
    expect(fieldPercentile(compare.z)!).toBeGreaterThan(0.5);
  });
});

describe("ordinalPercentile", () => {
  it("writes the ordinal a student would say out loud", () => {
    expect(ordinalPercentile(0.83)).toBe("83rd");
    expect(ordinalPercentile(0.21)).toBe("21st");
    expect(ordinalPercentile(0.22)).toBe("22nd");
    expect(ordinalPercentile(0.5)).toBe("50th");
  });

  it("uses th for the teens, not st/nd/rd", () => {
    expect(ordinalPercentile(0.11)).toBe("11th");
    expect(ordinalPercentile(0.12)).toBe("12th");
    expect(ordinalPercentile(0.13)).toBe("13th");
  });

  it("never claims a 100th or a 0th percentile", () => {
    // A normal tail is never certainty; "100th" reads as a guarantee.
    expect(ordinalPercentile(1)).toBe("99th");
    expect(ordinalPercentile(0)).toBe("1st");
    expect(ordinalPercentile(null)).toBeNull();
  });
});

describe("lookup cards carry a field position", () => {
  it("adds a percentile when there is a field, and none when there is not", () => {
    const stats = fieldStatsFromEventRows(field);
    const [withField] = [
      buildLookupCards({ teamKey: "frc3", event: field[2], field: stats }),
    ];
    const total = withField.find((card) => card.id === "totalPoints");
    expect(total?.percentile).not.toBeNull();
    expect(total!.percentile!).toBeGreaterThan(0.5);

    // A single team is not a field: no std, so no bar.
    const lonely = buildLookupCards({
      teamKey: "frc1",
      event: field[0],
      field: fieldStatsFromEventRows([field[0]]),
    });
    expect(lonely.find((card) => card.id === "totalPoints")?.percentile).toBeNull();
  });
});
