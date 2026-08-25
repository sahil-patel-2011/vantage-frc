import { describe, expect, it } from "vitest";
import {
  capabilityLabel,
  normalizePlanOperations,
  normalizePlanTendencies,
  splitScoutedByAlliance,
  teamNumberFromKey,
} from "./plan-sections";

const PLAN = {
  playbook: { title: "qm12 RED playbook" },
  operations: [
    {
      teamKey: "frc254",
      scoutSample: 7,
      autoCapability: 0.9,
      teleopCapability: 0.5,
      endgameCapability: 0,
      defenseLikely: true,
      foulRate: 0.4,
      pitNotes: ["swerve", "  ", "fast intake"],
    },
    { teamKey: "frc1678", scoutSample: 0 },
    { teamKey: "", scoutSample: 3 },
    "not-an-object",
  ],
  tendencies: [
    { teamKey: "frc254", labels: ["autonomous-leaning"], evidence: ["auto EPA is 30% of total"] },
    { teamKey: "frc971", labels: [], evidence: [] },
    { labels: ["orphan"] },
  ],
};

describe("normalizePlanOperations", () => {
  it("reads per-robot capabilities defensively", () => {
    const rows = normalizePlanOperations(PLAN);
    expect(rows.map((row) => row.teamKey)).toEqual(["frc254", "frc1678"]);
    const chief = rows[0]!;
    expect(chief.scoutSample).toBe(7);
    expect(chief.autoCapability).toBe(0.9);
    expect(chief.endgameCapability).toBe(0);
    expect(chief.defenseLikely).toBe(true);
    expect(chief.pitNotes).toEqual(["swerve", "fast intake"]);
  });

  it("clamps capabilities to 0..1 and drops non-finite values", () => {
    const rows = normalizePlanOperations({
      operations: [{ teamKey: "frc1", scoutSample: 2, autoCapability: 4, teleopCapability: "nope" }],
    });
    expect(rows[0]!.autoCapability).toBe(1);
    expect(rows[0]!.teleopCapability).toBeNull();
  });

  it("returns [] for missing/garbage plans", () => {
    expect(normalizePlanOperations(null)).toEqual([]);
    expect(normalizePlanOperations({ playbook: {} })).toEqual([]);
    expect(normalizePlanOperations([1, 2])).toEqual([]);
    expect(normalizePlanOperations("plan")).toEqual([]);
  });
});

describe("normalizePlanTendencies", () => {
  it("keeps only rows with a team and at least one label or evidence line", () => {
    const rows = normalizePlanTendencies(PLAN);
    expect(rows).toEqual([
      { teamKey: "frc254", labels: ["autonomous-leaning"], evidence: ["auto EPA is 30% of total"] },
    ]);
  });

  it("returns [] when tendencies are absent", () => {
    expect(normalizePlanTendencies({ playbook: {} })).toEqual([]);
    expect(normalizePlanTendencies(undefined)).toEqual([]);
  });
});

describe("splitScoutedByAlliance", () => {
  it("splits by lineup and drops zero-sample rows", () => {
    const rows = normalizePlanOperations(PLAN);
    const { allies, opponents } = splitScoutedByAlliance(rows, ["frc254", "frc999"], ["frc1678"]);
    expect(allies.map((row) => row.teamKey)).toEqual(["frc254"]);
    // frc1678 has scoutSample 0 — honest empty instead of an all-null row.
    expect(opponents).toEqual([]);
  });
});

describe("capabilityLabel", () => {
  it("maps 0..1 scores to drive-coach words", () => {
    expect(capabilityLabel(null)).toBeNull();
    expect(capabilityLabel(0.8)).toBe("strong");
    expect(capabilityLabel(0.5)).toBe("solid");
    expect(capabilityLabel(0.1)).toBe("developing");
  });
});

describe("teamNumberFromKey", () => {
  it("parses frc keys only", () => {
    expect(teamNumberFromKey("frc254")).toBe(254);
    expect(teamNumberFromKey("ftc254")).toBeNull();
    expect(teamNumberFromKey("frc")).toBeNull();
  });
});
