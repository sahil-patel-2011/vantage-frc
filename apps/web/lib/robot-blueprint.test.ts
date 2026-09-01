import { describe, expect, it } from "vitest";
import {
  cadProvider,
  optionalCadUrl,
  parseBlueprintAction,
  robotRollup,
  SEED_SUBSYSTEMS,
  subsystemReadiness,
  type EnrichedSubsystem,
} from "./robot-blueprint";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function subsystem(overrides: Partial<EnrichedSubsystem>): EnrichedSubsystem {
  return {
    id: Math.random().toString(36).slice(2),
    robotLabel: "competition",
    name: "Drivetrain",
    description: "",
    status: "tested",
    cadUrl: "https://cad.onshape.com/documents/abc",
    codeRef: "src/subsystems/Drivetrain.java",
    priorityId: ID,
    priorityCapability: "Fast cycles",
    priorityStatus: "committed",
    practiceAction: "Full cycle",
    bomSubsystem: "",
    sortOrder: 0,
    ops: {
      practice: { reps: 12, successRate: 83, avgSeconds: 5.1 },
      bom: { buildable: true, shortCount: 0 },
      failures7d: 0,
      openMaintenance: 0,
    },
    ...overrides,
  };
}

describe("cadProvider / optionalCadUrl", () => {
  it("labels known CAD hosts", () => {
    expect(cadProvider("https://cad.onshape.com/documents/x")).toBe("Onshape");
    expect(cadProvider("https://myhub.autodesk360.com/x")).toBe("Fusion 360");
    expect(cadProvider("https://grabcad.com/library/x")).toBe("GrabCAD");
    expect(cadProvider("https://example.com/model")).toBe("CAD");
    expect(cadProvider(null)).toBeNull();
  });
  it("validates https-only CAD links", () => {
    expect(optionalCadUrl("https://cad.onshape.com/d/1")).toBe("https://cad.onshape.com/d/1");
    expect(optionalCadUrl("")).toBeNull();
    expect(() => optionalCadUrl("http://cad.onshape.com/d/1")).toThrow(/https/);
    expect(() => optionalCadUrl("garbage")).toThrow(/https/);
  });
});

describe("subsystemReadiness", () => {
  it("scores by status when nothing blocks", () => {
    expect(subsystemReadiness(subsystem({ status: "competition_ready" }))).toEqual({ percent: 100, blockers: [] });
    expect(subsystemReadiness(subsystem({ status: "prototyping" })).percent).toBe(40);
  });
  it("caps on BOM shortfalls, failures, and maintenance in priority order", () => {
    const short = subsystemReadiness(
      subsystem({ status: "competition_ready", ops: { practice: null, bom: { buildable: false, shortCount: 2 }, failures7d: 0, openMaintenance: 0 } }),
    );
    expect(short.percent).toBe(70);
    expect(short.blockers).toEqual(["2 BOM parts short"]);
    const failing = subsystemReadiness(
      subsystem({ status: "competition_ready", ops: { practice: null, bom: null, failures7d: 1, openMaintenance: 2 } }),
    );
    expect(failing.percent).toBe(80);
    expect(failing.blockers).toContain("1 failure in 7d");
    expect(failing.blockers).toContain("2 open maintenance");
  });
});

describe("robotRollup", () => {
  it("handles empty and aggregates gaps", () => {
    expect(robotRollup([]).total).toBe(0);
    const rollup = robotRollup([
      subsystem({ status: "competition_ready" }),
      subsystem({
        name: "Climber",
        status: "prototyping",
        cadUrl: null,
        codeRef: "",
        priorityId: null,
        ops: { practice: { reps: 0, successRate: null, avgSeconds: null }, bom: null, failures7d: 0, openMaintenance: 0 },
      }),
    ]);
    expect(rollup.total).toBe(2);
    expect(rollup.ready).toBe(1);
    expect(rollup.percent).toBe(70); // (100 + 40) / 2
    expect(rollup.missingCad).toBe(1);
    expect(rollup.missingCode).toBe(1);
    expect(rollup.unlinkedStrategy).toBe(1);
    expect(rollup.untested).toBe(1);
  });

  it("treats missingCad as covered by a CAD URL or a vault row (no live Onshape required)", () => {
    const urlOnly = subsystem({ cadUrl: "https://cad.onshape.com/documents/abc", vaultDocumentCount: 0 });
    const vaultOnly = subsystem({ cadUrl: null, vaultDocumentCount: 1 });
    const both = subsystem({ cadUrl: "https://cad.onshape.com/documents/abc", vaultDocumentCount: 2 });
    const neither = subsystem({ cadUrl: null, vaultDocumentCount: 0 });
    expect(robotRollup([urlOnly, vaultOnly, both]).missingCad).toBe(0);
    expect(robotRollup([urlOnly, neither]).missingCad).toBe(1);
    expect(robotRollup([vaultOnly, neither]).missingCad).toBe(1);
    expect(robotRollup([neither, subsystem({ cadUrl: null })]).missingCad).toBe(2);
  });
});

describe("SEED_SUBSYSTEMS", () => {
  it("covers the standard FRC set with unique names", () => {
    const names = SEED_SUBSYSTEMS.map((entry) => entry.name);
    expect(names).toContain("Drivetrain");
    expect(names).toContain("Electronics");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("parseBlueprintAction", () => {
  it("seeds and adds with defaults", () => {
    expect(parseBlueprintAction({ action: "seed_subsystems", orgId: ORG })).toMatchObject({ robotLabel: "competition" });
    expect(parseBlueprintAction({ action: "add_subsystem", orgId: ORG, name: "Turret" })).toMatchObject({
      name: "Turret",
      description: "",
    });
  });
  it("builds sparse patches with validation", () => {
    const action = parseBlueprintAction({
      action: "update_subsystem",
      orgId: ORG,
      id: ID,
      status: "built",
      cadUrl: "https://cad.onshape.com/d/2",
      priorityId: null,
    });
    expect(action).toMatchObject({ patch: { status: "built", cadUrl: "https://cad.onshape.com/d/2", priorityId: null } });
    if (action.action === "update_subsystem") expect(action.patch.codeRef).toBeUndefined();
    expect(() => parseBlueprintAction({ action: "update_subsystem", orgId: ORG, id: ID })).toThrow(/No changes/);
    expect(() => parseBlueprintAction({ action: "update_subsystem", orgId: ORG, id: ID, status: "shiny" })).toThrow(/Invalid subsystem status/);
    expect(() => parseBlueprintAction({ action: "update_subsystem", orgId: ORG, id: ID, cadUrl: "ftp://x" })).toThrow(/https/);
  });
  it("rejects unsupported actions", () => {
    expect(() => parseBlueprintAction({ action: "transform", orgId: ORG })).toThrow(/Unsupported/);
  });
});
