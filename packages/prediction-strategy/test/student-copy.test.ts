import { describe, expect, it } from "vitest";
import {
  blendPrivateEpa,
  buildAllianceMatchup,
  buildAllianceWinBreakdown,
  buildPrivateEdgeView,
  buildTeamDossierFacts,
  opponentTendencies,
  predictMatch,
  signalsFromEventMetrics,
  simulateCounterPick,
  studentCacheSourceLabel,
  type EventMetricRow,
  type MatchResultFact,
} from "../src";

const JARGON = /\b(EPA|TBA|pEPA|Statbotics|FACT TBA|TBA\+scout)\b/;

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
];

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
];

function paintedStrings(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

describe("student cache source labels", () => {
  it("maps stored identifiers without leaking them", () => {
    expect(studentCacheSourceLabel("tba")).toBe("official matches");
    expect(studentCacheSourceLabel("statbotics")).toBe("season ratings");
    expect(studentCacheSourceLabel("reference")).toBe("official matches");
    expect(studentCacheSourceLabel("scout")).toBe("scout notes");
    expect(studentCacheSourceLabel(null)).toBe("official matches");
  });
});

describe("generated student-facing prediction copy", () => {
  const seasons = signalsFromEventMetrics(fixtureMetrics);
  const input = {
    matchKey: "2026miket_qm1",
    currentYear: 2026,
    eventLabel: "Kettering University Event #1",
    red: ["frc2337", "frc2"],
    blue: ["frc1"],
    seasons,
    operations: [{ teamKey: "frc1", scoutSample: 6, reliability: 72, foulRate: 1.8 }],
    matchResults: fixtureMatchResults,
    engineId: "strategy-engine-max-v1" as const,
  };
  const prediction = predictMatch(input);
  const breakdown = buildAllianceWinBreakdown(input);
  const matchup = buildAllianceMatchup({
    red: ["frc2337", "frc2"],
    blue: ["frc1"],
    metrics: fixtureMetrics,
    operations: input.operations,
  });
  const tendencies = opponentTendencies({
    opponentKeys: ["frc2337", "frc1"],
    metrics: fixtureMetrics,
    operations: input.operations,
  });
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
      },
    ],
    eventMetrics: fixtureMetrics.filter((row) => row.teamKey === "frc2337"),
    operations: [{ teamKey: "frc2337", scoutSample: 4, reliability: 94, foulRate: 0.2 }],
  });

  const painted = paintedStrings([
    ...prediction.keyFactors.flatMap((factor) => [factor.name, factor.evidence]),
    ...prediction.caveats,
    ...(prediction.reasoningSteps ?? []).flatMap((step) => [step.title, step.detail]),
    ...(prediction.citations ?? []).map((row) => row.summary),
    ...breakdown.keyFactors.flatMap((factor) => [factor.name, factor.evidence]),
    ...breakdown.caveats,
    ...breakdown.citations.map((row) => row.summary),
    ...breakdown.red.map((row) => row.evidence),
    ...breakdown.blue.map((row) => row.evidence),
    ...matchup.considerations,
    ...tendencies.flatMap((row) => row.evidence),
    ...cards.flatMap((card) => [card.title, card.value, card.citation.detail]),
  ]);

  it("does not emit leftover rating jargon on painted generator strings", () => {
    for (const line of painted) {
      expect(line, line).not.toMatch(JARGON);
    }
  });

  it("keeps stored source identifiers off dossier citation details", () => {
    expect(cards.find((card) => card.id === "identity-name")?.citation.detail).toBe(
      "Team identity from the official team record.",
    );
    expect(cards.find((card) => card.id === "season-epa-2026")?.title).toBe("2026 Season rating");
    expect(cards.find((card) => card.id === "season-epa-2026")?.citation.source).toBe("statbotics");
    expect(cards.find((card) => card.id === "season-epa-2026")?.citation.detail).toMatch(/season ratings/);
  });
});

describe("generated private-edge student copy", () => {
  it("skips missing public ratings without leftover jargon", () => {
    const skipped = blendPrivateEpa({
      teamKey: "frc254",
      publicEpa: null,
      scout: { autoRate: 0.9, teleopRate: 0.8, endgameRate: 0.7, sampleSize: 8 },
    });
    expect(skipped.skipped).toBe(true);
    if (!skipped.skipped) return;
    expect(skipped.reason).not.toMatch(JARGON);
    expect(skipped.reason).toMatch(/season rating/);
  });

  it("paints live and empty messages without leftover jargon", () => {
    const empty = buildPrivateEdgeView({
      eventKey: "2026miket",
      ourTeamKey: "frc1111",
      opponentTeamKeys: ["frc254"],
      pepa: [{ skipped: true, teamKey: "frc1111", reason: "no rating" }],
      ourRates: { autoRate: null, teleopRate: null, endgameRate: null, sampleSize: 0 },
      opponentRates: new Map(),
      observations: [],
      calibrations: [],
      digitalTwin: {
        skipped: true,
        headline: "none",
        remainingMatches: 0,
        highIrPacks: 0,
        activePacks: 0,
        cycleDegradePct: null,
      },
      cadLinks: [],
      knowledge: [],
      evidence: [],
    });
    expect(empty.message).not.toMatch(JARGON);
    expect(empty.message).toMatch(/season ratings/);
  });

  it("labels a live counter-pick from scouting numbers", () => {
    const result = simulateCounterPick({
      takenTeamKey: "frc254",
      ourTeamKey: "frc1111",
      pool: [
        { teamKey: "frc1111", pepa: 80, sampleSize: 6 },
        { teamKey: "frc254", pepa: 90, sampleSize: 6 },
        { teamKey: "frc10", pepa: 70, sampleSize: 6 },
        { teamKey: "frc20", pepa: 60, sampleSize: 6 },
        { teamKey: "frc30", pepa: 55, sampleSize: 6 },
      ],
    });
    expect(result.skipped).toBe(false);
    expect(result.reason).not.toMatch(JARGON);
    expect(result.reason).toMatch(/scouting numbers/);
  });
});
