import { describe, expect, it } from "vitest";
import {
  blueprintMissingCad,
  countMissingCad,
  hasCadCoverage,
  vaultedSubsystemIds,
} from "./blueprint-coverage";

const DRIVE = "11111111-1111-4111-8111-111111111111";
const INTAKE = "22222222-2222-4222-8222-222222222222";
const CLIMBER = "33333333-3333-4333-8333-333333333333";
const ONSHAPE = "https://cad.onshape.com/documents/abc";

describe("hasCadCoverage", () => {
  it("treats a CAD URL as coverage without a vault row", () => {
    expect(hasCadCoverage({ cadUrl: ONSHAPE, vaultDocumentCount: 0 })).toBe(true);
  });

  it("treats a vault row as coverage without a live Onshape URL", () => {
    expect(hasCadCoverage({ cadUrl: null, vaultDocumentCount: 1 })).toBe(true);
    expect(hasCadCoverage({ cadUrl: "", vaultDocumentCount: 2 })).toBe(true);
    expect(hasCadCoverage({ cadUrl: "   ", vaultDocumentCount: 1 })).toBe(true);
  });

  it("is missing when there is neither a URL nor a vault row", () => {
    expect(hasCadCoverage({ cadUrl: null })).toBe(false);
    expect(hasCadCoverage({ cadUrl: "", vaultDocumentCount: 0 })).toBe(false);
    expect(hasCadCoverage({})).toBe(false);
  });
});

describe("vaultedSubsystemIds", () => {
  it("keeps linked non-archived rows and drops unassigned or archived ones", () => {
    const ids = vaultedSubsystemIds([
      { subsystemId: DRIVE, status: "active" },
      { subsystemId: INTAKE, status: "superseded" },
      { subsystemId: CLIMBER, status: "archived" },
      { subsystemId: null, status: "active" },
    ]);
    expect([...ids].sort()).toEqual([DRIVE, INTAKE].sort());
  });
});

describe("missingCad = url OR vault row", () => {
  it("counts zero when every subsystem has a URL or a vault row", () => {
    expect(
      blueprintMissingCad(
        [
          { id: DRIVE, cadUrl: ONSHAPE },
          { id: INTAKE, cadUrl: null },
        ],
        [{ subsystemId: INTAKE, status: "active" }],
      ),
    ).toBe(0);
  });

  it("counts a subsystem that has only a URL", () => {
    expect(
      countMissingCad([{ id: DRIVE, cadUrl: ONSHAPE, vaultDocumentCount: 0 }]),
    ).toBe(0);
  });

  it("counts a subsystem that has only a vault row (no live Onshape)", () => {
    expect(
      blueprintMissingCad([{ id: DRIVE, cadUrl: null }], [{ subsystemId: DRIVE, status: "active" }]),
    ).toBe(0);
  });

  it("counts missing when the only vault row is archived or unassigned", () => {
    expect(
      blueprintMissingCad(
        [
          { id: DRIVE, cadUrl: null },
          { id: INTAKE, cadUrl: null },
        ],
        [
          { subsystemId: DRIVE, status: "archived" },
          { subsystemId: null, status: "active" },
        ],
      ),
    ).toBe(2);
  });

  it("mixes URL-only, vault-only, both, and neither", () => {
    const missing = blueprintMissingCad(
      [
        { id: DRIVE, cadUrl: ONSHAPE },
        { id: INTAKE, cadUrl: null },
        { id: CLIMBER, cadUrl: null },
        { id: "44444444-4444-4444-8444-444444444444", cadUrl: ONSHAPE },
      ],
      [
        { subsystemId: INTAKE, status: "active" },
        { subsystemId: "44444444-4444-4444-8444-444444444444", status: "active" },
      ],
    );
    expect(missing).toBe(1);
  });

  it("does not invent coverage from empty document lists", () => {
    expect(blueprintMissingCad([{ id: DRIVE, cadUrl: null }], [])).toBe(1);
    expect(countMissingCad([])).toBe(0);
  });
});
