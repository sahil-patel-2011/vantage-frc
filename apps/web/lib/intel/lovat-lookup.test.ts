import { describe, expect, it } from "vitest";
import {
  LOVAT_LOOKUP_METRIC_IDS,
  applyPicklistDisplayOrder,
  buildLookupCards,
  contributionShare,
  fieldCompare,
  fieldStatsFromEventRows,
  formatLookupValue,
  lookupCardVisible,
  lookupContributionLabel,
  lookupSourceLabel,
  movePicklistKey,
  scoutAveragesFromPayloads,
  scoutMetricVisibleWhen,
  scoutSeriesFromPayloads,
  selectedLookupCard,
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
    expect(cards).toHaveLength(LOVAT_LOOKUP_METRIC_IDS.length);
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

describe("scoutMetricVisibleWhen", () => {
  it("shows only auto or climb keys in auto, and climb in endgame", () => {
    expect(scoutMetricVisibleWhen("auto", "autoPoints")).toBe(true);
    expect(scoutMetricVisibleWhen("auto", "autoClimb")).toBe(true);
    expect(scoutMetricVisibleWhen("auto", "endgameClimb")).toBe(false);
    expect(scoutMetricVisibleWhen("teleop", "teleopPoints")).toBe(true);
    expect(scoutMetricVisibleWhen("teleop", "endgameClimb")).toBe(false);
    expect(scoutMetricVisibleWhen("endgame", "endgameClimb")).toBe(true);
    expect(scoutMetricVisibleWhen("endgame", "teleopPoints")).toBe(false);
  });
});

describe("lookupCardVisible", () => {
  const cards = buildLookupCards({
    teamKey: "frc3",
    event: field[2]!,
    field: fieldStatsFromEventRows(field),
    scout: scoutAveragesFromPayloads("frc3", [{ driverAbility: 4 }, { driverAbility: 6, autoClimb: 2 }]),
  });

  it("skips blank scout tiles instead of painting a 0", () => {
    const defense = cards.find((card) => card.id === "defenseEffectiveness");
    expect(defense?.value).toBeNull();
    expect(lookupCardVisible("all", defense!)).toBe(false);
  });

  it("keeps event standing cards on every phase and hides off-phase actions", () => {
    const total = cards.find((card) => card.id === "totalPoints")!;
    const auto = cards.find((card) => card.id === "autoPoints")!;
    const driver = cards.find((card) => card.id === "driverAbility")!;
    expect(lookupCardVisible("auto", total)).toBe(true);
    expect(lookupCardVisible("auto", auto)).toBe(true);
    expect(lookupCardVisible("auto", driver)).toBe(false);
    expect(lookupCardVisible("teleop", driver)).toBe(true);
  });
});

describe("selectedLookupCard", () => {
  it("returns the tapped card's real numbers and skips a blank select", () => {
    const cards = buildLookupCards({
      teamKey: "frc3",
      event: field[2]!,
      field: fieldStatsFromEventRows(field),
      history: [20, 40, 60],
    });
    const total = selectedLookupCard(cards, "totalPoints");
    expect(total?.label).toBe("Total points");
    expect(total?.display).toBe("60");
    expect(total?.compare.label).toMatch(/this event/);
    expect(lookupContributionLabel(total?.contribution ?? null)).toMatch(/% of this event/);
    expect(total?.sparkline).toMatch(/^M/);
    expect(lookupSourceLabel(total!.source)).toBe("Event");
    const driver = selectedLookupCard(cards, "driverAbility");
    expect(driver?.display).toBe("—");
    expect(lookupCardVisible("all", driver!)).toBe(false);
    expect(lookupContributionLabel(null)).toBeNull();
    expect(selectedLookupCard(cards, null)).toBeNull();
  });
});

describe("applyPicklistDisplayOrder", () => {
  it("reorders display without inventing or rewriting scores", () => {
    const ranked = [
      { teamKey: "frc3", score: 1.2 },
      { teamKey: "frc2", score: 0.4 },
      { teamKey: "frc1", score: -0.8 },
    ];
    const moved = applyPicklistDisplayOrder(ranked, ["frc1", "frc3", "frc2"]);
    expect(moved.map((row) => row.teamKey)).toEqual(["frc1", "frc3", "frc2"]);
    expect(moved.find((row) => row.teamKey === "frc3")?.score).toBe(1.2);
    expect(moved.find((row) => row.teamKey === "frc1")?.score).toBe(-0.8);
    const unknown = applyPicklistDisplayOrder(ranked, ["frc9", "frc2"]);
    expect(unknown.map((row) => row.teamKey)).toEqual(["frc2", "frc3", "frc1"]);
    expect(unknown.every((row) => ranked.some((item) => item.teamKey === row.teamKey && item.score === row.score))).toBe(
      true,
    );
    expect(movePicklistKey(["frc3", "frc2", "frc1"], "frc1", "up")).toEqual(["frc3", "frc1", "frc2"]);
    expect(movePicklistKey(["frc3", "frc2", "frc1"], "frc3", "up")).toEqual(["frc3", "frc2", "frc1"]);
  });
});

describe("scoutSeriesFromPayloads", () => {
  it("needs two real match values before drawing a scout sparkline", () => {
    expect(scoutSeriesFromPayloads([{ driverAbility: 4 }]).driverAbility).toBeUndefined();
    expect(scoutSeriesFromPayloads([{ driverAbility: 4 }, { driverAbility: 6 }]).driverAbility).toEqual([4, 6]);
  });
});
