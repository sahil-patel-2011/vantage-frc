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
  shrinkTowardField,
  streakValue,
  streakKind,
  reliabilityHazard,
  linearFit,
  pearson,
  spearman,
  kendallTau,
  zoneOccupancy,
  closestApproach,
  pathSpeed,
  pathBoundingBox,
  timeToCollision,
  colleyRatings,
  masseyRatings,
  bradleyTerry,
  trueskillFromMatches,
  brierScore,
  logLoss,
  calibrationBins,
  topsis,
  shapleyCredit,
  draftTier,
  buildDeepReport,
  formatTier,
  boardSections,
  emptyDeepCopy,
  wilsonInterval,
  climbPosterior,
  gini,
  theil,
  controlLimits,
  changePoint,
  poissonPmf,
  counterfactualSwap,
  noticeableFocus,
  hodgesLehmann,
  theilSen,
  lMomentCv,
  meanAbsDev,
  rangeWidth,
  quartileSkew,
  wideStat,
  slot0Value,
  slot0Ready,
  slot0Row,
  buildWideReport,
  emptyWideCopy,
  wideSections,
  seriesAutoPoints,
  statAutoPoints,
  lovatAllianceSpread,
  lovatExactWin,
  flipAllianceWin,
  buildLovatExactReport,
  lovatVisibleWhen,
  lovatSourceMix,
  improveSourceMix,
} from "./compute";

const rows = [
  { teamKey: "frc1", qual: true, values: { autoPoints: 13.0 } },
  { teamKey: "frc2", qual: true, values: { autoPoints: 25.0 } },
  { teamKey: "frc3", qual: true, values: { autoPoints: 41.0 } },
  { teamKey: "frc3", qual: true, values: { autoPoints: 41.0 } },
  { teamKey: "frc1", matchKey: "sf1", qual: false, values: { autoPoints: 13.0 } },
  { teamKey: "frc2", matchKey: "sf1", qual: false, values: { autoPoints: 25.0 } },
  { teamKey: "frc3", matchKey: "sf1", qual: false, values: { autoPoints: 41.0 } },
  { teamKey: "frc3", matchKey: "sf2", qual: false, values: { autoPoints: 41.0 } },
];

describe("auto-last4-timeline22", () => {
  it("does not invent a field average from one blank team", () => {
    expect(populationMean([])).toBeNull();
    expect(zScore(10, null, 2)).toBeNull();
    expect(contributionShare(10, 0)).toBeNull();
    expect(sparklinePath([1])).toBeNull();
    expect(emptyCopy().badge).toBe("Needs setup");
    expect(SLUG).toBe("auto-last4-timeline22");
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
    expect(report.slug).toBe("auto-last4-timeline22");
    expect(report.summary.known).toBeGreaterThan(0);
    expect(studentChrome().event).toBe("Compared to this event");
    expect(studentChrome().setup).toBe("Needs setup");
    expect(histogram([1, 2, 2, 8]).length).toBeGreaterThan(0);
    expect(forecastNext([1, 2, 3])).not.toBeNull();
    expect(bootstrapMean([13.0, 25.0, 41.0])).not.toBeNull();
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


describe("auto-last4-timeline22-deep", () => {
  it("shrink, streak, and hazard stay blank without numbers", () => {
    expect(shrinkTowardField(null, 10, 3)).toBeNull();
    expect(streakValue([])).toBeNull();
    expect(reliabilityHazard([])).toBeNull();
    expect(streakKind([]).kind).toBe("unknown");
    expect(linearFit([1])).toBeNull();
    expect(pearson([1], [1, 2])).toBeNull();
    expect(spearman([1], [])).toBeNull();
    expect(kendallTau([1], [2])).toBeNull();
  });

  it("path zones and collisions need real geometry", () => {
    expect(zoneOccupancy([]).every((zone) => zone.share == null)).toBe(true);
    expect(closestApproach([{ t: 0, x: 0, y: 0 }], [{ t: 0, x: 1, y: 0 }])).toBeNull();
    expect(
      closestApproach(
        [
          { t: 0, x: 0, y: 0 },
          { t: 2, x: 40, y: 0 },
        ],
        [
          { t: 0, x: 40, y: 0 },
          { t: 2, x: 0, y: 0 },
        ],
      )?.distance,
    ).toBeLessThan(5);
    expect(pathSpeed([{ t: 0, x: 0, y: 0 }])).toBeNull();
    expect(pathBoundingBox([])).toBeNull();
    expect(timeToCollision([{ t: 0, x: 0, y: 0 }], [{ t: 0, x: 100, y: 0 }])).toBeNull();
  });

  it("ranking models refuse empty schedules", () => {
    expect(colleyRatings([])).toEqual([]);
    expect(masseyRatings([])).toEqual([]);
    expect(bradleyTerry([])).toEqual([]);
    expect(trueskillFromMatches([])).toBeNull();
    expect(brierScore([])).toBeNull();
    expect(logLoss([])).toBeNull();
    expect(calibrationBins([]).length).toBe(0);
    expect(topsis([], [1, 1])).toEqual([]);
    expect(shapleyCredit([])).toBeNull();
    expect(draftTier(null, [])).toBe("unknown");
  });

  it("builds a deep report without inventing ratings", () => {
    const rows = [
      { teamKey: "frc1", matchKey: "qm1", qual: true, values: { autoPoints: 10 } },
      { teamKey: "frc2", matchKey: "qm1", qual: true, values: { autoPoints: 14 } },
      { teamKey: "frc3", matchKey: "qm2", qual: true, values: { autoPoints: 18 } },
      { teamKey: "frc1", matchKey: "qm3", qual: true, values: { autoPoints: 11 } },
      { teamKey: "frc2", matchKey: "qm3", qual: true, values: { autoPoints: 15 } },
      { teamKey: "frc3", matchKey: "qm3", qual: true, values: { autoPoints: 20 } },
      { teamKey: "frc1", matchKey: "sf1", qual: false, values: { autoPoints: 12 } },
      { teamKey: "frc2", matchKey: "sf1", qual: false, values: { autoPoints: 16 } },
      { teamKey: "frc3", matchKey: "sf1", qual: false, values: { autoPoints: 21 } },
    ];
    const report = buildDeepReport({ teamKey: "frc3", rows });
    expect(report.slug).toBe("auto-last4-timeline22");
    expect(report.cards.some((card) => card.value != null)).toBe(true);
    expect(report.quality.teams).toBeGreaterThan(0);
    expect(formatTier(report.draft.tier).length).toBeGreaterThan(0);
    expect(boardSections(report).length).toBe(6);
    const blank = buildDeepReport({ teamKey: "frc9", rows: [{ teamKey: "frc9", values: {} }] });
    expect(blank.cards.every((card) => card.value == null)).toBe(true);
    expect(blank.brier).toBeNull();
    expect(blank.skill).toBeNull();
    expect(emptyDeepCopy().badge).toBe("Needs setup");
    expect(wilsonInterval(3, 10)).not.toBeNull();
    expect(climbPosterior(2, 4)).not.toBeNull();
    expect(gini([1, 2, 3])).not.toBeNull();
    expect(theil([1, 2, 3])).not.toBeNull();
    expect(controlLimits([1, 2, 3])).not.toBeNull();
    expect(changePoint([1, 1, 8, 9])).toBeGreaterThan(0);
    expect(poissonPmf(2, 1.5)).not.toBeNull();
    expect(counterfactualSwap(rows, ["frc1", "frc2"], "frc2", "frc3", "autoPoints")).not.toBeNull();
    expect(noticeableFocus().length).toBeGreaterThan(10);
  });
});


describe("auto-last4-timeline22-wide", () => {
  it("wide estimators stay blank without numbers", () => {
    expect(hodgesLehmann([])).toBeNull();
    expect(theilSen([1])).toBeNull();
    expect(lMomentCv([])).toBeNull();
    expect(meanAbsDev([])).toBeNull();
    expect(rangeWidth([])).toBeNull();
    expect(quartileSkew([])).toBeNull();
    expect(wideStat([]).n).toBe(0);
    expect(slot0Value([])).toBeNull();
    expect(slot0Ready([])).toBe(false);
  });

  it("builds a wide report from real samples only", () => {
    const rows = [
      { teamKey: "frc1", matchKey: "qm1", qual: true, values: { autoPoints: 10 } },
      { teamKey: "frc2", matchKey: "qm1", qual: true, values: { autoPoints: 14 } },
      { teamKey: "frc3", matchKey: "qm2", qual: true, values: { autoPoints: 18 } },
      { teamKey: "frc1", matchKey: "qm3", qual: true, values: { autoPoints: 11 } },
      { teamKey: "frc2", matchKey: "qm3", qual: true, values: { autoPoints: 15 } },
      { teamKey: "frc3", matchKey: "qm3", qual: true, values: { autoPoints: 20 } },
      { teamKey: "frc1", matchKey: "sf1", qual: false, values: { autoPoints: 12 } },
      { teamKey: "frc2", matchKey: "sf1", qual: false, values: { autoPoints: 16 } },
      { teamKey: "frc3", matchKey: "sf1", qual: false, values: { autoPoints: 21 } },
    ];
    const report = buildWideReport({ teamKey: "frc3", rows });
    expect(report.slug).toBe("auto-last4-timeline22");
    expect(report.packs.length).toBe(4);
    expect(statAutoPoints(rows, "frc3").n).toBeGreaterThan(0);
    expect(seriesAutoPoints(rows, "frc9").length).toBe(0);
    expect(emptyWideCopy().badge).toBe("Needs setup");
    expect(wideSections(report).length).toBeGreaterThan(2);
    const blank = buildWideReport({ teamKey: "frc9", rows: [{ teamKey: "frc9", values: {} }] });
    expect(blank.packs.every((pack) => pack.stat.n === 0)).toBe(true);
    expect(hodgesLehmann([1, 2, 3])).not.toBeNull();
    expect(theilSen([1, 2, 4])).not.toBeNull();
    expect(slot0Row([9, 8]).mean).toBe(9);
  });
});


describe("auto-last4-timeline22-lovat", () => {
  it("copies Lovat win% and refuses a zero-width guarantee", () => {
    expect(lovatAllianceSpread([])).toBeNull();
    expect(lovatExactWin({ mean: 40, std: 0 }, { mean: 38, std: 0 })).toBeNull();
    const win = lovatExactWin({ mean: 54, std: 8 }, { mean: 48, std: 7 });
    expect(win).not.toBeNull();
    expect((win?.redWinPct ?? 0) + (win?.blueWinPct ?? 0)).toBeCloseTo(1, 3);
    const flipped = flipAllianceWin(win!);
    expect(flipped.redWinPct).toBe(win?.blueWinPct);
  });

  it("builds the 22-metric Lovat lookup without filling blanks", () => {
    const rows = [
      { teamKey: "frc1", qual: true, values: { totalPoints: 40, autoPoints: 8, teleopPoints: 24, endgameClimb: 8 } },
      { teamKey: "frc2", qual: true, values: { totalPoints: 48, autoPoints: 10, teleopPoints: 28, endgameClimb: 10 } },
      { teamKey: "frc3", qual: true, values: { totalPoints: 62, autoPoints: 14, teleopPoints: 36, endgameClimb: 12 } },
      { teamKey: "frc3", matchKey: "sf1", qual: false, values: { totalPoints: 64, autoPoints: 15, teleopPoints: 37, endgameClimb: 12 } },
    ];
    const report = buildLovatExactReport({ teamKey: "frc3", rows });
    expect(report.cards).toHaveLength(22);
    expect(report.cards[0]?.value).not.toBeNull();
    expect(report.pick == null || Number.isFinite(report.pick)).toBe(true);
    const blank = buildLovatExactReport({ teamKey: "frc9", rows: [{ teamKey: "frc9", values: {} }] });
    expect(blank.cards.every((card) => card.value == null)).toBe(true);
    expect(blank.win).toBeNull();
    expect(lovatVisibleWhen("auto", "autoPoints")).toBe(true);
    expect(lovatVisibleWhen("auto", "endgameClimb")).toBe(false);
    expect(lovatSourceMix(null, null)).toBeNull();
    expect(improveSourceMix(10, 12, 4)).not.toBeNull();
  });
});
