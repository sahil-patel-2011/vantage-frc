import { describe, expect, it } from "vitest";
import {
  buildAllianceMatchup,
  buildOperationsFromScoutEntries,
  buildTeamOperationalSignal,
  computeScoutQuality,
  deriveScoutCapabilities,
  formatScoutProvenance,
  opponentTendencies,
  predictMatch,
  signalsFromEventMetrics,
  type EventMetricRow,
  type ScoutEntryRecord,
} from "../src";

const seasons = signalsFromEventMetrics([
  {
    teamKey: "frc2337",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 42,
    epaAuto: 9,
    epaEndgame: 10,
    wins: 7,
    losses: 2,
    ties: 0,
  },
  {
    teamKey: "frc1",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 25,
    epaAuto: 4,
    epaEndgame: 5,
    wins: 3,
    losses: 5,
    ties: 0,
  },
  {
    teamKey: "frc2",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 30,
    epaAuto: 6,
    epaEndgame: 7,
    wins: 5,
    losses: 3,
    ties: 0,
  },
  {
    teamKey: "frc3",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 22,
    epaAuto: 3,
    epaEndgame: 4,
    wins: 2,
    losses: 6,
    ties: 0,
  },
  {
    teamKey: "frc4",
    year: 2026,
    eventKey: "2026miket",
    source: "statbotics",
    epaTotal: 20,
    epaAuto: 3,
    epaEndgame: 4,
    wins: 2,
    losses: 6,
    ties: 0,
  },
  {
    teamKey: "frc5",
    year: 2026,
    eventKey: "2026miket",
    source: "tba",
    epaTotal: 24,
    epaAuto: 5,
    epaEndgame: 5,
    wins: 4,
    losses: 4,
    ties: 0,
  },
] satisfies EventMetricRow[]);

function matchEntry(
  partial: Partial<ScoutEntryRecord> & Pick<ScoutEntryRecord, "id" | "teamKey" | "payload">,
): ScoutEntryRecord {
  return {
    entryType: "match",
    confidence: "normal",
    scoutUserId: partial.scoutUserId ?? "scout-a",
    matchKey: partial.matchKey ?? "2026miket_qm1",
    ...partial,
  };
}

describe("scout ops bridge", () => {
  it("derives auto/teleop capabilities from conventional payload keys", () => {
    const profile = deriveScoutCapabilities([
      { payload: { autoPoints: 8, teleopCycles: 10, climb: 1 }, weight: 1 },
      { payload: { auto: 6, cycles: 9, endgame: 1 }, weight: 1 },
    ]);
    expect(profile.autoRate).toBeGreaterThan(0.4);
    expect(profile.teleopRate).toBeGreaterThan(0.4);
    expect(profile.endgameRate).toBeGreaterThan(0);
    expect(profile.evidence.join(" ")).toMatch(/auto|teleop/i);
  });

  it("downweights anomalous scouts with transparent reasons", () => {
    const entries: ScoutEntryRecord[] = [
      matchEntry({
        id: "11111111-1111-1111-1111-111111111111",
        teamKey: "frc1",
        scoutUserId: "consistent",
        payload: { totalPoints: 40, fouls: 0 },
      }),
      matchEntry({
        id: "22222222-2222-2222-2222-222222222222",
        teamKey: "frc1",
        scoutUserId: "consistent",
        payload: { totalPoints: 42, fouls: 1 },
      }),
      matchEntry({
        id: "33333333-3333-3333-3333-333333333333",
        teamKey: "frc1",
        scoutUserId: "outlier",
        payload: { totalPoints: 120, fouls: 0 },
      }),
      matchEntry({
        id: "44444444-4444-4444-4444-444444444444",
        teamKey: "frc1",
        scoutUserId: "outlier",
        payload: { totalPoints: 118, fouls: 0 },
      }),
    ];
    const quality = computeScoutQuality(entries);
    const outlier = quality.scouts.find((scout) => scout.scoutUserId === "outlier");
    const consistent = quality.scouts.find((scout) => scout.scoutUserId === "consistent");
    expect(outlier?.weight).toBeLessThan(consistent?.weight ?? 1);
    expect(quality.transparency.some((line) => /downweighted/i.test(line))).toBe(true);
  });

  it("builds operational signals with pit notes and entry provenance", () => {
    const entries: ScoutEntryRecord[] = [
      matchEntry({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        teamKey: "frc1",
        payload: {
          totalPoints: 35,
          fouls: 2,
          autoPoints: 7,
          teleopCycles: 8,
          disabled: false,
        },
      }),
      matchEntry({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        teamKey: "frc1",
        payload: { totalPoints: 38, fouls: 2, autoPoints: 6, cycles: 9 },
      }),
      matchEntry({
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        teamKey: "frc1",
        payload: { totalPoints: 36, fouls: 1, auto: 5, gamePieces: 7 },
      }),
      {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        teamKey: "frc1",
        entryType: "pit",
        confidence: "high",
        scoutUserId: "pit-scout",
        payload: { notes: "Strong auto coral; weak climb under defense", defense: true },
      },
    ];
    const built = buildTeamOperationalSignal("frc1", entries);
    expect(built).not.toBeNull();
    expect(built!.foulRate).toBeGreaterThan(0);
    expect(built!.autoCapability).toBeGreaterThan(0);
    expect(built!.pitNotes.some((note) => /auto coral/i.test(note))).toBe(true);
    expect(built!.defenseLikely).toBe(true);
    expect(built!.provenance.some((ref) => ref.influence === "pit_note")).toBe(true);
    expect(built!.provenance.some((ref) => ref.influence === "auto_capability")).toBe(true);
    expect(formatScoutProvenance(built!.provenance)).toMatch(/auto_capability|pit_note/);
  });

  it("feeds strategy factors with scoutEntryIds provenance", () => {
    const ops = buildOperationsFromScoutEntries([
      matchEntry({
        id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        teamKey: "frc1",
        payload: { totalPoints: 20, fouls: 2, autoPoints: 8, teleopCycles: 10, breakdown: true },
      }),
      matchEntry({
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        teamKey: "frc1",
        payload: { totalPoints: 18, fouls: 2, autoPoints: 7, cycles: 9, disabled: true },
      }),
      matchEntry({
        id: "99999999-9999-9999-9999-999999999999",
        teamKey: "frc1",
        payload: { totalPoints: 22, fouls: 1, auto: 6, gamePieces: 8 },
      }),
      matchEntry({
        id: "88888888-8888-8888-8888-888888888888",
        teamKey: "frc2337",
        payload: { totalPoints: 50, fouls: 0, autoPoints: 10, cycles: 12 },
      }),
    ]).map((row) => ({
      teamKey: row.teamKey,
      scoutSample: row.scoutSample,
      reliability: row.reliability,
      foulRate: row.foulRate,
      qualityWeight: row.qualityWeight,
      autoCapability: row.autoCapability,
      teleopCapability: row.teleopCapability,
      endgameCapability: row.endgameCapability,
      defenseLikely: row.defenseLikely,
      pitNotes: row.pitNotes,
      scoutEntryIds: [...new Set(row.provenance.map((ref) => ref.entryId))],
      qualityNotes: row.quality.transparency,
    }));

    const prediction = predictMatch({
      matchKey: "2026miket_qm1",
      currentYear: 2026,
      red: ["frc2337", "frc2", "frc3"],
      blue: ["frc1", "frc4", "frc5"],
      seasons,
      operations: ops,
    });
    const scoutFactor = prediction.keyFactors.find((factor) => factor.name === "scout reliability");
    expect(scoutFactor?.scoutEntryIds?.length).toBeGreaterThan(0);
    expect(scoutFactor?.evidence).toMatch(/quality-weighted|Scout entries/i);

    const tendencies = opponentTendencies({
      opponentKeys: ["frc1"],
      metrics: [
        {
          teamKey: "frc1",
          year: 2026,
          eventKey: "2026miket",
          source: "tba",
          epaTotal: 25,
          epaAuto: 4,
          epaEndgame: 5,
        },
      ],
      operations: ops,
    });
    expect(tendencies[0]?.scoutEntryIds?.length).toBeGreaterThan(0);
    expect(tendencies[0]?.labels).toContain("reliability-risk");

    const matchup = buildAllianceMatchup({
      red: ["frc2337", "frc2", "frc3"],
      blue: ["frc1", "frc4", "frc5"],
      metrics: [
        {
          teamKey: "frc2337",
          year: 2026,
          eventKey: "2026miket",
          source: "statbotics",
          epaTotal: 42,
          epaAuto: 9,
        },
        {
          teamKey: "frc1",
          year: 2026,
          eventKey: "2026miket",
          source: "tba",
          epaTotal: 25,
          epaAuto: 4,
        },
      ],
      operations: ops,
    });
    expect(matchup.considerations.some((item) => /provenance entry ids/i.test(item))).toBe(true);
    expect(matchup.blue.find((team) => team.teamKey === "frc1")?.scoutEntryIds.length).toBeGreaterThan(
      0,
    );
  });

  it("excludes low-confidence match entries from primary signals but keeps provenance", () => {
    const built = buildTeamOperationalSignal("frc1", [
      matchEntry({
        id: "12121212-1212-1212-1212-121212121212",
        teamKey: "frc1",
        confidence: "low",
        payload: { totalPoints: 99, fouls: 5, autoPoints: 12 },
      }),
      matchEntry({
        id: "13131313-1313-1313-1313-131313131313",
        teamKey: "frc1",
        confidence: "high",
        payload: { totalPoints: 40, fouls: 0, autoPoints: 6 },
      }),
      matchEntry({
        id: "14141414-1414-1414-1414-141414141414",
        teamKey: "frc1",
        confidence: "normal",
        payload: { totalPoints: 41, fouls: 0, autoPoints: 5 },
      }),
      matchEntry({
        id: "15151515-1515-1515-1515-151515151515",
        teamKey: "frc1",
        confidence: "normal",
        payload: { totalPoints: 39, fouls: 1, autoPoints: 5 },
      }),
    ]);
    expect(built?.provenance.some((ref) => ref.influence === "excluded_low_confidence")).toBe(true);
    // Low-confidence foul=5 must not dominate; usable entries average ~0.33.
    expect(built?.foulRate).toBeLessThan(1);
    expect(built?.foulRate).toBeGreaterThanOrEqual(0);
  });
});
