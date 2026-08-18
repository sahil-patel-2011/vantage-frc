import { describe, expect, it } from "vitest";
import {
  batteryHealth,
  cartSlot,
  competitionReadiness,
  monthsBetween,
  parseBatteryAction,
  rankForRotation,
  summarizeLogs,
  BATTERY_BREAK_IN_CUE,
  batteryBreakInCue,
  type BatteryHealth,
  type BatteryStatus,
} from "./battery";

describe("batteryHealth", () => {
  it("grades a fresh pack as good with a high score", () => {
    const health = batteryHealth({ internalResistanceMohm: 11, restingVoltage: 12.9, cycleCount: 0, ageMonths: 0 });
    expect(health.status).toBe("good");
    expect(health.score).toBeGreaterThanOrEqual(95);
  });

  it("flags elevated internal resistance as aging", () => {
    expect(batteryHealth({ internalResistanceMohm: 16 }).status).toBe("aging");
  });

  it("flags resistance at the retire threshold as retire", () => {
    expect(batteryHealth({ internalResistanceMohm: 22 }).status).toBe("retire");
  });

  it("retire outranks aging when multiple signals fire", () => {
    const health = batteryHealth({ internalResistanceMohm: 25, restingVoltage: 11.5 });
    expect(health.status).toBe("retire");
  });

  it("flags a low resting voltage as aging", () => {
    expect(batteryHealth({ restingVoltage: 11.8 }).status).toBe("aging");
  });

  it("flags an old, heavily-cycled pack as aging even with no resistance reading", () => {
    expect(batteryHealth({ cycleCount: 400 }).status).toBe("aging");
    expect(batteryHealth({ ageMonths: 60 }).status).toBe("aging");
  });

  it("stays good with no measurements at all", () => {
    expect(batteryHealth({}).status).toBe("good");
  });
});

describe("summarizeLogs", () => {
  it("counts match and practice runs as cycles and finds the latest readings", () => {
    const summary = summarizeLogs([
      { kind: "charge", restingVoltage: 12.9, internalResistanceMohm: null, matchKey: null, createdAt: "2026-03-01T10:00:00Z" },
      { kind: "match", restingVoltage: null, internalResistanceMohm: null, matchKey: "2026wimi_qm5", createdAt: "2026-03-01T12:00:00Z" },
      { kind: "resistance_test", restingVoltage: null, internalResistanceMohm: 14, matchKey: null, createdAt: "2026-03-02T09:00:00Z" },
      { kind: "practice", restingVoltage: null, internalResistanceMohm: null, matchKey: null, createdAt: "2026-02-20T09:00:00Z" },
    ]);
    expect(summary.cycleCount).toBe(2);
    expect(summary.lastInternalResistanceMohm).toBe(14);
    expect(summary.lastRestingVoltage).toBe(12.9);
    expect(summary.lastUsedAt).toBe("2026-03-01T12:00:00Z");
    expect(summary.lastChargedAt).toBe("2026-03-01T10:00:00Z");
  });

  it("returns null readings for an empty log", () => {
    const summary = summarizeLogs([]);
    expect(summary.cycleCount).toBe(0);
    expect(summary.lastInternalResistanceMohm).toBeNull();
    expect(summary.lastUsedAt).toBeNull();
  });
});

describe("batteryBreakInCue", () => {
  it("cues packs with fewer than three logged match/practice cycles", () => {
    expect(batteryBreakInCue(null)).toBeNull();
    expect(batteryBreakInCue(0)).toBe(BATTERY_BREAK_IN_CUE);
    expect(batteryBreakInCue(2)).toBe(BATTERY_BREAK_IN_CUE);
    expect(batteryBreakInCue(3)).toBeNull();
  });
});

describe("monthsBetween", () => {
  it("computes whole months elapsed", () => {
    expect(monthsBetween("2026-01-15", new Date("2026-07-17T00:00:00Z"))).toBe(6);
  });
  it("returns null for a missing date", () => {
    expect(monthsBetween(null, new Date())).toBeNull();
  });
});

describe("rankForRotation", () => {
  const pack = (id: string, status: BatteryStatus, health: BatteryHealth, lastUsedAt: string | null) => ({ id, status, health, lastUsedAt });
  it("drops retired packs and picks the healthiest, least-recently-used first", () => {
    const ranked = rankForRotation([
      pack("a", "active", { status: "good", score: 90, reasons: [] }, "2026-03-01T12:00:00Z"),
      pack("b", "active", { status: "good", score: 90, reasons: [] }, "2026-02-01T12:00:00Z"),
      pack("c", "retired", { status: "good", score: 100, reasons: [] }, null),
      pack("d", "active", { status: "retire", score: 20, reasons: [] }, null),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("competitionReadiness", () => {
  const good = { status: "good" as const, score: 95, reasons: [] as string[] };
  it("marks a fresh active pack ready", () => {
    expect(
      competitionReadiness({
        status: "active",
        health: good,
        lastMeasuredAt: new Date().toISOString(),
        lastRestingVoltage: 12.8,
        lastInternalResistanceMohm: 12,
      }).ready,
    ).toBe(true);
  });
  it("blocks quarantined packs", () => {
    expect(
      competitionReadiness({
        status: "quarantine",
        health: good,
        lastMeasuredAt: new Date().toISOString(),
        lastRestingVoltage: 12.8,
        lastInternalResistanceMohm: 12,
      }).ready,
    ).toBe(false);
  });
  it("blocks stale readings", () => {
    expect(
      competitionReadiness({
        status: "active",
        health: good,
        lastMeasuredAt: "2020-01-01T00:00:00Z",
        lastRestingVoltage: 12.8,
        lastInternalResistanceMohm: 12,
      }).ready,
    ).toBe(false);
  });
});

describe("cartSlot", () => {
  const now = "2026-03-07T18:00:00.000Z";

  it("keeps a pack in cool-down for 15 minutes after a real charge log", () => {
    const slot = cartSlot({
      status: "active",
      lastChargedAt: "2026-03-07T17:50:00.000Z",
      lastUsedAt: "2026-03-07T16:00:00.000Z",
      lastTestedAt: null,
      nowIso: now,
    });
    expect(slot.kind).toBe("cooling");
    expect(slot.minutesRemaining).toBe(5);
  });

  it("asks for a Beak test after cooldown when no post-charge measurement exists", () => {
    const slot = cartSlot({
      status: "active",
      lastChargedAt: "2026-03-07T17:40:00.000Z",
      lastUsedAt: "2026-03-07T16:00:00.000Z",
      lastTestedAt: "2026-03-07T17:40:00.000Z",
      nowIso: now,
    });
    expect(slot.kind).toBe("ready_to_test");
  });

  it("marks Ready only after a test logged after the charge", () => {
    const slot = cartSlot({
      status: "active",
      lastChargedAt: "2026-03-07T17:30:00.000Z",
      lastUsedAt: "2026-03-07T16:00:00.000Z",
      lastTestedAt: "2026-03-07T17:50:00.000Z",
      nowIso: now,
    });
    expect(slot.kind).toBe("ready");
  });

  it("never invents Ready when the pack just came off the robot", () => {
    const slot = cartSlot({
      status: "active",
      lastChargedAt: "2026-03-07T12:00:00.000Z",
      lastUsedAt: "2026-03-07T17:00:00.000Z",
      lastTestedAt: "2026-03-07T12:20:00.000Z",
      nowIso: now,
    });
    expect(slot.kind).toBe("needs_charge");
  });
});

describe("parseBatteryAction", () => {
  it("parses a create_pack action", () => {
    const action = parseBatteryAction({ action: "create_pack", orgId: "o1", label: "B-01", nominalAh: 18, assignment: "Cart" });
    expect(action).toMatchObject({ action: "create_pack", label: "B-01", nominalAh: 18, assignment: "Cart" });
  });

  it("parses assign_pack", () => {
    expect(parseBatteryAction({ action: "assign_pack", orgId: "o1", id: "b1", assignment: "Robot" })).toMatchObject({
      action: "assign_pack",
      assignment: "Robot",
    });
  });

  it("rejects a create_pack with no label", () => {
    expect(() => parseBatteryAction({ action: "create_pack", orgId: "o1" })).toThrow(/label/);
  });

  it("rejects a negative measurement", () => {
    expect(() => parseBatteryAction({ action: "log_event", orgId: "o1", batteryId: "b1", kind: "resistance_test", internalResistanceMohm: -3 })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => parseBatteryAction({ action: "set_status", orgId: "o1", id: "b1", status: "melted" })).toThrow(/status/);
  });

  it("rejects an update with no changes", () => {
    expect(() => parseBatteryAction({ action: "update_pack", orgId: "o1", id: "b1" })).toThrow(/No changes/);
  });

  it("rejects an unsupported action", () => {
    expect(() => parseBatteryAction({ action: "explode", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
