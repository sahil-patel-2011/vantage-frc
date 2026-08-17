import { describe, expect, it } from "vitest";
import {
  MIN_PEPA_SAMPLE,
  blendPrivateEpa,
  buildComponentDifferentials,
  buildOpponentProfile,
  buildPrivateEdgeView,
  clusterPitSignals,
  extractPitSignals,
  forecastDigitalTwin,
  linkCadToScout,
  simulateCounterPick,
  crossSeasonVsOpponent,
} from "../src/private-edge";

describe("private EPA", () => {
  it("skips when public EPA or scout sample is missing", () => {
    expect(
      blendPrivateEpa({
        teamKey: "frc254",
        publicEpa: null,
        scout: { autoRate: 0.9, teleopRate: 0.8, endgameRate: 0.7, sampleSize: 8 },
      }).skipped,
    ).toBe(true);
    expect(
      blendPrivateEpa({
        teamKey: "frc254",
        publicEpa: 80,
        scout: { autoRate: 0.9, teleopRate: 0.8, endgameRate: 0.7, sampleSize: MIN_PEPA_SAMPLE - 1 },
      }).skipped,
    ).toBe(true);
  });

  it("blends 0.6 public + 0.4 scouted component EPA", () => {
    const result = blendPrivateEpa({
      teamKey: "frc254",
      publicEpa: 100,
      scout: { autoRate: 1, teleopRate: 1, endgameRate: 1, sampleSize: 6 },
    });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.scoutComponentEpa).toBe(100);
    expect(result.pepa).toBe(100);
    expect(result.blend).toEqual({ public: 0.6, scout: 0.4 });
  });

  it("pulls pepa below public EPA when scout rates are weak", () => {
    const result = blendPrivateEpa({
      teamKey: "frc1",
      publicEpa: 80,
      scout: { autoRate: 0, teleopRate: 0, endgameRate: 0, sampleSize: 5 },
    });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.pepa).toBeLessThan(80);
    expect(result.scoutComponentEpa).toBe(20);
  });
});

describe("differentials", () => {
  it("skips unless both teams have scout depth", () => {
    expect(
      buildComponentDifferentials({
        ourTeamKey: "frc1111",
        opponentTeamKey: "frc254",
        our: { autoRate: 0.5, teleopRate: 0.5, endgameRate: 0.5, sampleSize: 8 },
        opponent: { autoRate: 0.9, teleopRate: 0.9, endgameRate: 0.9, sampleSize: 1 },
      }),
    ).toEqual([]);
  });

  it("reports climb and cycle gaps from real scout rates only", () => {
    const rows = buildComponentDifferentials({
      ourTeamKey: "frc1111",
      opponentTeamKey: "frc254",
      our: {
        autoRate: 0.4,
        teleopRate: 0.5,
        endgameRate: 0.73,
        sampleSize: 8,
        cycleTimeSeconds: 3.0,
      },
      opponent: {
        autoRate: 0.9,
        teleopRate: 0.8,
        endgameRate: 0.98,
        sampleSize: 10,
        cycleTimeSeconds: 1.8,
      },
    });
    expect(rows.some((row) => row.field === "climb")).toBe(true);
    expect(rows.some((row) => row.field === "cycle_time" && row.headline.includes("1.2s"))).toBe(true);
  });
});

describe("opponent profile", () => {
  it("splits climb by alliance color when n is real", () => {
    const obs = [
      ...Array.from({ length: 6 }, (_, i) => ({
        teamKey: "frc971",
        alliance: "red" as const,
        payload: { climb: 1 },
        updatedAt: `2026-03-01T0${i}:00:00.000Z`,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        teamKey: "frc971",
        alliance: "blue" as const,
        payload: { climb: 0 },
        updatedAt: `2026-03-01T1${i}:00:00.000Z`,
      })),
    ];
    const profile = buildOpponentProfile("frc971", obs);
    expect(profile?.climbRed).toBe(1);
    expect(profile?.climbBlue).toBe(0);
    expect(profile?.headlines[0]).toMatch(/89%|100% climb on red/);
  });

  it("returns null without enough observations", () => {
    expect(buildOpponentProfile("frc1", [{ teamKey: "frc1", payload: { climb: 1 } }])).toBeNull();
  });
});

describe("counter-pick + twin + pit + cad + knowledge", () => {
  it("skips Monte Carlo without a private pool", () => {
    const sim = simulateCounterPick({
      takenTeamKey: "frc254",
      ourTeamKey: "frc1111",
      pool: [{ teamKey: "frc1111", pepa: 50, sampleSize: 8 }],
    });
    expect(sim.skipped).toBe(true);
    expect(sim.recommendedTeamKey).toBeNull();
  });

  it("recommends a partner from org pEPA only", () => {
    const sim = simulateCounterPick({
      takenTeamKey: "frc254",
      ourTeamKey: "frc1111",
      pool: [
        { teamKey: "frc1111", pepa: 40, sampleSize: 8 },
        { teamKey: "frc254", pepa: 90, sampleSize: 8 },
        { teamKey: "frc1678", pepa: 80, sampleSize: 8 },
        { teamKey: "frc2056", pepa: 30, sampleSize: 8 },
        { teamKey: "frc33", pepa: 20, sampleSize: 8 },
      ],
    });
    expect(sim.skipped).toBe(false);
    expect(sim.recommendedTeamKey).toBe("frc1678");
  });

  it("does not invent a 15% cycle drop without IR or timestamps", () => {
    const twin = forecastDigitalTwin({
      remainingMatches: 6,
      packs: [],
      ourCycleObservations: [],
    });
    expect(twin.skipped).toBe(true);
    expect(twin.headline).not.toMatch(/15%/);
  });

  it("reports high-IR packs from real logs", () => {
    const twin = forecastDigitalTwin({
      remainingMatches: 4,
      packs: [
        { label: "3", status: "active", irMohm: 28 },
        { label: "1", status: "active", irMohm: 12 },
      ],
      ourCycleObservations: [],
    });
    expect(twin.skipped).toBe(false);
    expect(twin.highIrPacks).toBe(1);
    expect(twin.headline).toMatch(/pack #3|1\/2 active packs/i);
  });

  it("clusters intake jams from scout notes", () => {
    const signals = extractPitSignals([
      { teamKey: "frc1111", matchKey: "qm1", alliance: "blue", payload: { notes: "intake jammed after defense" } },
      { teamKey: "frc1111", matchKey: "qm2", alliance: "blue", payload: { jammed: true, notes: "jam again" } },
      { teamKey: "frc1111", matchKey: "qm3", alliance: "blue", payload: { notes: "intake jammed" } },
    ]);
    expect(signals).toHaveLength(3);
    const lines = clusterPitSignals(signals, "frc1111");
    expect(lines[0]).toMatch(/intake jam/);
    expect(lines[0]).toMatch(/blue/);
  });

  it("links CAD subsystems only when scout fields have samples", () => {
    const links = linkCadToScout({
      subsystems: [{ id: "s1", name: "Prototype v3 intake", category: "intake" }],
      fieldSamples: [{ fieldKey: "cycleTime", sampleSize: 8 }],
    });
    expect(links).toHaveLength(1);
    expect(linkCadToScout({
      subsystems: [{ id: "s1", name: "Intake", category: "intake" }],
      fieldSamples: [{ fieldKey: "cycleTime", sampleSize: 1 }],
    })).toEqual([]);
  });

  it("emits cross-season notes only when opponent number appears in real records", () => {
    const notes = crossSeasonVsOpponent({
      opponentTeamNumber: 1114,
      decisions: [
        { title: "Auto vs 1114", rationale: "We lost when auto failed vs 1114." },
        { title: "Bumper color", rationale: "Unrelated." },
      ],
      failures: [{ title: "Intake jam", rootCause: "belt skip" }],
      pages: [],
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("decision");
  });
});

describe("buildPrivateEdgeView", () => {
  it("stays empty when every team is skipped", () => {
    const view = buildPrivateEdgeView({
      eventKey: "2026miket",
      ourTeamKey: "frc1111",
      opponentTeamKeys: ["frc254"],
      pepa: [{ skipped: true, teamKey: "frc1111", reason: "no epa" }],
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
    expect(view.status).toBe("empty");
    expect(view.pepa).toEqual([]);
  });
});
