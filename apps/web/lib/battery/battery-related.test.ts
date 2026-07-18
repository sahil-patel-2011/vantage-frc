import { describe, expect, it } from "vitest";
import {
  BATTERIES_BUILD_RELATED_INCLUDE,
  BATTERIES_TEAM_RELATED_INCLUDE,
  batteryNextActions,
  formatPackEvidence,
  packHasCycles,
  packHasMeasurement,
} from "./battery-related";
import type { BatteryPackSnap } from "./battery-related";

function pack(partial: Partial<BatteryPackSnap> & Pick<BatteryPackSnap, "id" | "label">): BatteryPackSnap {
  return {
    status: "active",
    cycleCount: 0,
    lastInternalResistanceMohm: null,
    lastRestingVoltage: null,
    lastChargedAt: null,
    health: { status: "good", score: 100, reasons: [] },
    readiness: { ready: false, reasons: ["No voltage or resistance reading yet"] },
    ...partial,
  };
}

describe("battery Soft-UI helpers", () => {
  it("detects real measurements vs empty packs", () => {
    expect(packHasMeasurement(pack({ id: "a", label: "B-01" }))).toBe(false);
    expect(packHasMeasurement(pack({ id: "a", label: "B-01", lastInternalResistanceMohm: 12 }))).toBe(true);
    expect(packHasCycles(pack({ id: "a", label: "B-01", cycleCount: 0 }))).toBe(false);
    expect(packHasCycles(pack({ id: "a", label: "B-01", cycleCount: 3 }))).toBe(true);
  });

  it("formats pack evidence from logs only — never fabricates 0 cycles or blank IR", () => {
    expect(
      formatPackEvidence({
        cycleCount: 0,
        nominalAh: 18,
        lastInternalResistanceMohm: null,
        lastRestingVoltage: null,
        ageMonths: null,
        lastChargedAt: null,
        formatWhen: () => "never",
      }),
    ).toBe("18 Ah");

    expect(
      formatPackEvidence({
        cycleCount: 0,
        nominalAh: null,
        lastInternalResistanceMohm: null,
        lastRestingVoltage: null,
        ageMonths: null,
        lastChargedAt: null,
        formatWhen: () => "never",
      }),
    ).toBe("No IR, voltage, or cycle logs yet");

    expect(
      formatPackEvidence({
        cycleCount: 4,
        nominalAh: null,
        lastInternalResistanceMohm: 13.2,
        lastRestingVoltage: 12.7,
        ageMonths: 10,
        lastChargedAt: "2026-07-01T12:00:00Z",
        formatWhen: () => "Jul 1",
      }),
    ).toBe("4 cycles logged · 13.2 mΩ · 12.7 V · 10 mo · charged Jul 1");
  });

  it("asks for first pack when fleet is empty", () => {
    const actions = batteryNextActions({ orgId: "org-1", packs: [], logCount: 0 });
    expect(actions[0]?.id).toBe("add-pack");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.label + a.detail))).toBe(true);
  });

  it("prioritizes resistance logging when packs lack measurements", () => {
    const actions = batteryNextActions({
      orgId: "org-1",
      packs: [pack({ id: "a", label: "B-01" })],
      logCount: 0,
    });
    expect(actions[0]?.id).toBe("log-ir");
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
  });

  it("uses focused Team / Build related includes without DEMO labels", () => {
    expect(BATTERIES_TEAM_RELATED_INCLUDE).toContain("fmea");
    expect(BATTERIES_BUILD_RELATED_INCLUDE).toContain("fmea");
    expect(BATTERIES_TEAM_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(batteryNextActions({ packs: [], logCount: 0 }).map((a) => a.id)).toEqual(["workspace"]);
  });
});
