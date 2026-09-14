import { describe, expect, it } from "vitest";
import {
  SLUG,
  bestEdge,
  bootstrapMean,
  buildCards,
  buildReport,
  contributionShare,
  defaultWeights,
  emptyCopy,
  fieldCompare,
  filterOwn,
  forecastNext,
  histogram,
  interferenceWindows,
  parseSampleRows,
  pathCurvature,
  pathLength,
  populationMean,
  rankTeams,
  sparklinePath,
  studentChrome,
  teamValue,
  trimmedMean,
  weightedPickScore,
  windowRows,
  worstHole,
  zScore,
  describeKernel,
  eloFromMatches,
  hasEnough,
  kalmanSmooth,
  scouterAgreement,
  winFromMargin,
} from "./compute";

const rows = [
  { teamKey: "frc1", qual: true, values: { autoPoints: 24.0 } },
  { teamKey: "frc2", qual: true, values: { autoPoints: 21.0 } },
  { teamKey: "frc3", qual: true, values: { autoPoints: 40.0 } },
  { teamKey: "frc3", qual: true, values: { autoPoints: 40.0 } },
];

describe("auto-event-rank", () => {
  it("does not invent a field average from one blank team", () => {
    expect(populationMean([])).toBeNull();
    expect(zScore(10, null, 2)).toBeNull();
    expect(contributionShare(10, 0)).toBeNull();
    expect(sparklinePath([1])).toBeNull();
    expect(emptyCopy().badge).toBe("Needs setup");
    expect(SLUG).toBe("auto-event-rank");
  });

  it("compares a real sample to this event and keeps scout blanks empty", () => {
    const cards = buildCards({ teamKey: "frc3", rows });
    const lead = cards.find((card) => card.id === "autoPoints");
    expect(lead?.value).not.toBeNull();
    expect(lead?.display).not.toBe("—");
    const other = buildCards({
      teamKey: "frc9",
      rows: [{ teamKey: "frc9", values: {} }],
      fieldRows: rows,
    });
    expect(other.every((card) => card.value == null || card.display === "—")).toBe(true);
    expect(fieldCompare(null, 10, 2).tone).toBe("unknown");
  });

  it("windows and own-filter never invent rows", () => {
    expect(windowRows(rows).every((row) => row.teamKey.startsWith("frc"))).toBe(true);
    expect(filterOwn(rows, null)).toEqual([]);
    expect(filterOwn(rows, "3").every((row) => row.teamKey === "frc3")).toBe(true);
    expect(parseSampleRows([{ teamKey: "nope" }])).toEqual([]);
    expect(trimmedMean([1, 2, 100])).not.toBeNull();
    expect(teamValue(rows, "frc3", "autoPoints")).not.toBeNull();
  });

  it("path helpers need two real points before measuring", () => {
    expect(pathLength([{ t: 0, x: 0, y: 0 }])).toBeNull();
    expect(pathLength([{ t: 0, x: 0, y: 0 }, { t: 1, x: 3, y: 4 }])).toBe(5);
    expect(
      interferenceWindows([
        [
          { t: 0, x: 0, y: 0 },
          { t: 2, x: 40, y: 0 },
        ],
        [
          { t: 0, x: 40, y: 0 },
          { t: 2, x: 0, y: 0 },
        ],
      ]).length,
    ).toBeGreaterThan(0);
    expect(pathCurvature([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 0 }, { t: 2, x: 1, y: 1 }])).toBeGreaterThan(0);
  });

  it("builds a report without filling missing ratings", () => {
    const report = buildReport({ teamKey: "frc3", rows });
    expect(report.slug).toBe("auto-event-rank");
    expect(report.summary.known).toBeGreaterThan(0);
    expect(studentChrome().event).toBe("Compared to this event");
    expect(studentChrome().setup).toBe("Needs setup");
    expect(histogram([1, 2, 2, 8]).length).toBeGreaterThan(0);
    expect(forecastNext([1, 2, 3])).not.toBeNull();
    expect(bootstrapMean([24.0, 21.0, 40.0])).not.toBeNull();
    expect(rankTeams(rows, ["frc1", "frc2", "frc3"]).some((row) => row.rank === 1)).toBe(true);
    expect(weightedPickScore(report.cards, defaultWeights()) == null || Number.isFinite(weightedPickScore(report.cards, defaultWeights()))).toBe(true);
    const blank = buildCards({ teamKey: "frc9", rows: [{ teamKey: "frc9", values: {} }] });
    expect(worstHole(blank)).toBeNull();
    expect(bestEdge(blank)).toBeNull();
    expect(eloFromMatches([] as Array<{ won: boolean; opp: number }>)).toBeNull();
    expect(eloFromMatches([{ won: true, opp: 1500 }])).not.toBeNull();
    expect(kalmanSmooth([1, 2, 3]).length).toBe(3);
    expect(scouterAgreement([4, 5], [4, 6])).not.toBeNull();
    expect(winFromMargin(12)).not.toBeNull();
    expect(hasEnough(rows, "frc3", 1)).toBe(true);
    expect(describeKernel()).toContain("Compared to this event");
  });
});
