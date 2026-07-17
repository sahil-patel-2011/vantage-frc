import { describe, expect, it } from "vitest";
import {
  buildAllianceMatchup,
  buildAllianceWinBreakdown,
  buildStrategyPlaybook,
  buildTeamDossierFacts,
  citeMatchResults,
  dossierHasReferenceFacts,
  fuseSeasonSignals,
  opponentTendencies,
  pickListHintsForAlliance,
  predictMatch,
  predictionAccuracy,
  runWhatIf,
  seasonWeight,
  signalsFromEventMetrics,
  signalsFromYearMetrics,
  type EventMetricRow,
  type MatchResultFact,
} from "../src";

/** TBA/Statbotics-shaped fixture — mirrors Neon `team_event_metrics` + worker mappers. */
const fixtureMetrics: EventMetricRow[] = [
  {
    teamKey: "frc2337",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 42.5,
    epaAuto: 8.5,
    epaEndgame: 10,
    wins: 8,
    losses: 2,
    ties: 0,
    rank: 2,
  },
  {
    teamKey: "frc1",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 28,
    epaAuto: 5,
    epaEndgame: 6,
    wins: 4,
    losses: 4,
    ties: 0,
    rank: 18,
  },
  {
    teamKey: "frc2",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 31,
    epaAuto: 6,
    epaEndgame: 7,
    wins: 5,
    losses: 3,
    ties: 0,
    rank: 12,
  },
  {
    teamKey: "frc3",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 22,
    epaAuto: 4,
    epaEndgame: 5,
    wins: 3,
    losses: 5,
    ties: 0,
    rank: 28,
  },
  {
    teamKey: "frc4",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 19,
    epaAuto: 3,
    epaEndgame: 4,
    wins: 2,
    losses: 6,
    ties: 0,
    rank: 36,
  },
  {
    teamKey: "frc5",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 24,
    epaAuto: 5,
    epaEndgame: 5,
    wins: 4,
    losses: 4,
    ties: 0,
    rank: 22,
  },
  // Missing EPA must never become a fake demo default
  {
    teamKey: "frc9999",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: null,
  },
];

/** TBA matches_ref-shaped results for FACT citations. */
const fixtureMatchResults: MatchResultFact[] = [
  {
    matchKey: "2026miket_qm3",
    eventKey: "2026miket",
    winningAlliance: "red",
    red: ["frc2337", "frc10", "frc11"],
    blue: ["frc20", "frc21", "frc22"],
    redScore: 98,
    blueScore: 71,
  },
  {
    matchKey: "2026miket_qm7",
    eventKey: "2026miket",
    winningAlliance: "blue",
    red: ["frc30", "frc31", "frc32"],
    blue: ["frc1", "frc4", "frc40"],
    redScore: 55,
    blueScore: 64,
  },
  {
    matchKey: "2026miket_qm9",
    eventKey: "2026miket",
    winningAlliance: null,
    red: ["frc2", "frc3", "frc5"],
    blue: ["frc50", "frc51", "frc52"],
  },
];

const seasons = signalsFromEventMetrics(fixtureMetrics);

const prediction = predictMatch({
  matchKey: "2026miket_qm1",
  currentYear: 2026,
  eventLabel: "Kettering University Event #1",
  red: ["frc2337", "frc2", "frc3"],
  blue: ["frc1", "frc4", "frc5"],
  seasons,
  operations: [
    { teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 },
    { teamKey: "frc2337", scoutSample: 4, reliability: 94, foulRate: 0.2 },
  ],
  matchResults: fixtureMatchResults,
});

describe("weighted prediction", () => {
  it("weights current data above the prior two seasons", () => {
    expect([seasonWeight(2026, 2026), seasonWeight(2026, 2025), seasonWeight(2026, 2024)]).toEqual([
      1, 0.55, 0.3,
    ]);
    expect(seasonWeight(2026, 2023)).toBe(0);
  });

  it("returns calibrated bounds, factors, and deterministic probabilities", () => {
    expect(prediction.pRed).toBeGreaterThan(0.5);
    expect(prediction.confidenceLow).toBeLessThan(prediction.pRed);
    expect(prediction.confidenceHigh).toBeGreaterThan(prediction.pRed);
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("weighted scoring");
    expect(prediction.keyFactors[0]?.evidence).toMatch(/statbotics|tba|2026miket/);
    expect(prediction.keyFactors[0]?.kind).toBe("model");
    expect(prediction.caveats.some((item) => item.includes("MODEL"))).toBe(true);
  });

  it("blends scout foul exposure when org observations exist", () => {
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("foul exposure");
    expect(prediction.keyFactors.map((factor) => factor.name)).toContain("scout reliability");
  });

  it("cites TBA FACT match results separately from MODEL factors", () => {
    const factFactors = prediction.keyFactors.filter((factor) => factor.kind === "fact");
    expect(factFactors.length).toBeGreaterThan(0);
    expect(factFactors.some((factor) => factor.evidence.startsWith("FACT"))).toBe(true);
    expect(prediction.citations?.some((row) => row.matchKey === "2026miket_qm3")).toBe(true);
    // Unscored matches must not become fake facts
    expect(prediction.citations?.some((row) => row.matchKey === "2026miket_qm9")).toBe(false);
  });
});

describe("TBA-shaped signal builders", () => {
  it("maps fixture metrics without inventing EPA for missing rows", () => {
    expect(seasons.find((row) => row.teamKey === "frc9999")).toBeUndefined();
    expect(seasons.find((row) => row.teamKey === "frc2337")?.epa).toBe(42.5);
    expect(seasons.find((row) => row.teamKey === "frc2337")?.matches).toBe(10);
    expect(seasons.find((row) => row.teamKey === "frc2337")?.source).toBe("statbotics");
  });

  it("builds alliance matchup considerations from metrics + scout", () => {
    const matchup = buildAllianceMatchup({
      red: ["frc2337", "frc2", "frc3"],
      blue: ["frc1", "frc4", "frc5"],
      metrics: fixtureMetrics,
      operations: [{ teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 }],
    });
    expect(matchup.redTotalEpa).toBeGreaterThan(matchup.blueTotalEpa!);
    expect(matchup.considerations.some((item) => /Alliance EPA/.test(item))).toBe(true);
    expect(matchup.considerations.some((item) => /foul rate/i.test(item))).toBe(true);
  });

  it("derives opponent tendencies with cited evidence", () => {
    const tendencies = opponentTendencies({
      opponentKeys: ["frc1", "frc4"],
      metrics: fixtureMetrics,
      operations: [{ teamKey: "frc1", scoutSample: 6, reliability: 60, foulRate: 2 }],
    });
    expect(tendencies[0]?.labels).toContain("foul-prone");
    expect(tendencies[0]?.evidence.join(" ")).toMatch(/frc1/);
  });

  it("surfaces pick-list ranks only for alliance teams present on lists", () => {
    const hints = pickListHintsForAlliance(
      ["frc2337", "frc1"],
      [
        { teamKey: "frc2337", listName: "First picks", rank: 1, tier: "A", notes: "Anchor" },
        { teamKey: "frc99", listName: "First picks", rank: 2 },
        { teamKey: "frc1", listName: "Defense", rank: 3, notes: "Foul risk" },
      ],
    );
    expect(hints).toHaveLength(2);
    expect(hints[0]?.teamKey).toBe("frc2337");
  });

  it("citeMatchResults skips unscored rows and labels FACT", () => {
    const citations = citeMatchResults(fixtureMatchResults, ["frc2337", "frc1", "frc4"]);
    expect(citations).toHaveLength(2);
    expect(citations.every((row) => row.kind === "fact")).toBe(true);
    expect(citations[0]?.summary).toMatch(/^FACT/);
  });
});

describe("alliance 3v3 contribution breakdown", () => {
  it("attributes leave-one-out Δp and rating shares without inventing EPA", () => {
    const input = {
      matchKey: "2026miket_qm1",
      currentYear: 2026,
      red: ["frc2337", "frc2", "frc3"],
      blue: ["frc1", "frc4", "frc5"],
      seasons,
      operations: [
        { teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 },
        { teamKey: "frc2337", scoutSample: 4, reliability: 94, foulRate: 0.2 },
      ],
      matchResults: fixtureMatchResults,
    };
    const live = predictMatch(input);
    const breakdown = buildAllianceWinBreakdown(input);
    expect(breakdown.pRed).toBe(live.pRed);
    expect(breakdown.red).toHaveLength(3);
    expect(breakdown.blue).toHaveLength(3);
    const redShares = breakdown.red.reduce((sum, row) => sum + row.shareOfAlliance, 0);
    expect(redShares).toBeGreaterThan(0.99);
    expect(redShares).toBeLessThan(1.01);
    const anchor = breakdown.red.find((row) => row.teamKey === "frc2337");
    expect(anchor?.shareOfAlliance).toBeGreaterThan(0.3);
    expect(anchor?.deltaPRed).toBeGreaterThan(0);
    expect(anchor?.kind).toBe("model");
    expect(anchor?.evidence).toMatch(/^MODEL/);
    expect(breakdown.citations.length).toBeGreaterThan(0);
    expect(breakdown.keyFactors.some((factor) => factor.kind === "fact")).toBe(true);
  });

  it("attaches contributions on predictMatch for UI/API consumers", () => {
    expect(prediction.contributions?.red).toHaveLength(3);
    expect(prediction.contributions?.blue).toHaveLength(3);
    const strongest = [...(prediction.contributions?.red ?? [])].sort(
      (a, b) => b.contributionPts - a.contributionPts,
    )[0];
    expect(strongest?.teamKey).toBe("frc2337");
  });
});

describe("prediction to strategy", () => {
  it("shows what-if assumptions without rewriting the baseline", () => {
    const scenario = runWhatIf(prediction, [
      { alliance: "blue", label: "successful endgame", pointDelta: 12 },
    ]);
    expect(scenario.pRed).toBeLessThan(prediction.pRed);
    expect(scenario.assumptions[0]?.label).toBe("successful endgame");
  });

  it("builds an actionable playbook and post-match debrief", () => {
    const playbook = buildStrategyPlaybook({
      prediction,
      ourAlliance: "red",
      opponentFoulRisk: "high",
    });
    expect(playbook.priorities.length).toBeGreaterThanOrEqual(3);
    expect(playbook.debriefPrompts).toHaveLength(3);
    expect(playbook.provenance.length).toBeGreaterThan(0);
    expect(playbook.priorities.some((item) => /2337/.test(item))).toBe(true);
  });

  it("tracks classification and probability accuracy", () => {
    expect(
      predictionAccuracy([
        { pRed: 0.8, winner: "red" },
        { pRed: 0.4, winner: "blue" },
      ]),
    ).toEqual({ count: 2, accuracy: 1, brierScore: 0.1 });
  });
});

describe("Statbotics / year EPA fusion", () => {
  it("maps year metrics and skips null EPA", () => {
    const yearSignals = signalsFromYearMetrics([
      { teamKey: "frc2337", year: 2025, source: "statbotics", epaTotal: 38, epaAuto: 7 },
      { teamKey: "frc2337", year: 2024, source: "statbotics", epaTotal: null },
    ]);
    expect(yearSignals).toHaveLength(1);
    expect(yearSignals[0]?.matches).toBe(18);
    expect(yearSignals[0]?.epa).toBe(38);
  });

  it("prefers event Statbotics over year TBA for the same team-year", () => {
    const fused = fuseSeasonSignals({
      eventMetrics: [
        {
          teamKey: "frc2337",
          year: 2026,
          eventKey: "2026miket",
          source: "statbotics",
          epaTotal: 42.5,
          wins: 8,
          losses: 2,
          ties: 0,
        },
      ],
      yearMetrics: [
        { teamKey: "frc2337", year: 2026, source: "tba", epaTotal: 40 },
        { teamKey: "frc2337", year: 2025, source: "statbotics", epaTotal: 35 },
      ],
    });
    const current = fused.find((row) => row.year === 2026);
    expect(current?.epa).toBe(42.5);
    expect(current?.source).toBe("statbotics");
    expect(current?.eventKey).toBe("2026miket");
    expect(fused.find((row) => row.year === 2025)?.epa).toBe(35);
  });

  it("prefers Statbotics when two year rows compete", () => {
    const fused = fuseSeasonSignals({
      eventMetrics: [],
      yearMetrics: [
        { teamKey: "frc1", year: 2026, source: "tba", epaTotal: 20 },
        { teamKey: "frc1", year: 2026, source: "statbotics", epaTotal: 28 },
      ],
    });
    expect(fused).toHaveLength(1);
    expect(fused[0]?.epa).toBe(28);
    expect(fused[0]?.source).toBe("statbotics");
  });
});

describe("season dossier fact cards", () => {
  it("emits cited cards only from real TBA/Statbotics/scout facts", () => {
    const cards = buildTeamDossierFacts({
      identity: {
        teamKey: "frc2337",
        teamNumber: 2337,
        nickname: "EngiNERDs",
        name: "EngiNERDs",
        city: "Grand Blanc",
        stateProv: "MI",
        country: "USA",
        rookieYear: 2007,
        source: "tba",
        syncedAt: "2026-03-01T00:00:00.000Z",
      },
      yearMetrics: [
        {
          teamKey: "frc2337",
          year: 2026,
          source: "statbotics",
          epaTotal: 42.5,
          epaAuto: 8.5,
          epaTeleop: 24,
          epaEndgame: 10,
          syncedAt: "2026-03-10T00:00:00.000Z",
        },
        { teamKey: "frc2337", year: 2025, source: "statbotics", epaTotal: null },
      ],
      eventMetrics: fixtureMetrics.filter((row) => row.teamKey === "frc2337"),
      operations: [{ teamKey: "frc2337", scoutSample: 4, reliability: 94, foulRate: 0.2 }],
    });
    expect(cards.some((card) => card.id === "season-epa-2026")).toBe(true);
    expect(cards.some((card) => card.id === "season-epa-2025")).toBe(false);
    expect(cards.find((card) => card.id === "season-epa-2026")?.citation.source).toBe("statbotics");
    expect(cards.find((card) => card.category === "scout")?.citation.source).toBe("scout");
    expect(dossierHasReferenceFacts(cards)).toBe(true);
  });

  it("reports empty reference facts when only identity exists", () => {
    const cards = buildTeamDossierFacts({
      identity: {
        teamKey: "frc9999",
        teamNumber: 9999,
        nickname: null,
        name: "Ghost",
        city: null,
        stateProv: null,
        country: null,
        rookieYear: null,
      },
      yearMetrics: [],
      eventMetrics: [{ teamKey: "frc9999", year: 2026, source: "tba", epaTotal: null }],
    });
    expect(cards.every((card) => card.category === "identity")).toBe(true);
    expect(dossierHasReferenceFacts(cards)).toBe(false);
  });
});
