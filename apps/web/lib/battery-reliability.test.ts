import { describe, expect, it } from "vitest";
import {
  batteryFmeaSignals,
  batteryPitFlags,
  classifyMatchReady,
  packStatusToPit,
  pitStatusToPack,
  summarizeFleet,
} from "./battery-reliability";

const orgId = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-07-17T18:00:00.000Z");

describe("battery reliability bridge", () => {
  it("never releases a cooling pack or one tested before the full cooldown", () => {
    const values = { status: "active", voltage: 12.8, resistanceMilliohms: 10, measuredAt: new Date(now).toISOString(), now,
      lastChargedAt: new Date(now - 60_000).toISOString(), lastUsedAt: null, lastTestedAt: new Date(now - 120_000).toISOString() };
    expect(classifyMatchReady(values)).toBe("review");
    const chargedAt = new Date(now - 16 * 60_000).toISOString();
    expect(classifyMatchReady({ ...values, lastChargedAt: chargedAt, lastTestedAt: new Date(now - 15 * 60_000).toISOString() })).toBe("review");
    expect(classifyMatchReady({ ...values, lastChargedAt: chargedAt, lastTestedAt: new Date(now - 30_000).toISOString() })).toBe("ready");
    expect(classifyMatchReady({ ...values, lastChargedAt: chargedAt, lastTestedAt: new Date(now - 30_000).toISOString(), lastUsedAt: new Date(now).toISOString() })).toBe("review");
  });
  it("requires recorded readings and valid measurement time", () => {
    const values = { status: "active", voltage: 12.8, resistanceMilliohms: 10, measuredAt: new Date(now).toISOString(), now };
    expect(classifyMatchReady({ ...values, measuredAt: "invalid" })).toBe("review");
    expect(classifyMatchReady({ ...values, measuredAt: new Date(now + 1).toISOString() })).toBe("review");
    expect(classifyMatchReady({ ...values, resistanceMilliohms: null })).toBe("review");
    expect(classifyMatchReady({ ...values, resistanceMilliohms: 19 })).toBe("review");
  });
  it("maps quarantine ↔ service for pit UI", () => {
    expect(packStatusToPit("quarantine")).toBe("service");
    expect(pitStatusToPack("service")).toBe("quarantine");
  });

  it("classifies match-ready packs with freshness", () => {
    expect(
      classifyMatchReady({
        status: "active",
        voltage: 12.7,
        resistanceMilliohms: 12,
        measuredAt: new Date(now - 60 * 60 * 1000).toISOString(),
        now,
      }),
    ).toBe("ready");
    expect(
      classifyMatchReady({
        status: "active",
        voltage: 12.7,
        resistanceMilliohms: 19,
        measuredAt: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
        now,
      }),
    ).toBe("review");
    expect(
      classifyMatchReady({
        status: "active",
        voltage: 12.7,
        resistanceMilliohms: 22,
        healthStatus: "retire",
        measuredAt: new Date(now).toISOString(),
        now,
      }),
    ).toBe("review");
  });

  it("summarizes fleet and emits Event Day / FMEA signals from evidence", () => {
    const fleet = summarizeFleet([
      {
        id: "a",
        label: "A1",
        status: "active",
        measuredAt: new Date(now - 30 * 60 * 1000).toISOString(),
        voltage: 12.8,
        resistanceMilliohms: 12,
        now,
      },
      {
        id: "b",
        label: "B2",
        status: "quarantine",
        measuredAt: new Date(now).toISOString(),
        voltage: 12.1,
        // Aging band (15–19 mΩ) so quarantine contributes serviceCount without
        // also counting as retire; C3 alone is past RESISTANCE_RETIRE_MOHM (20).
        resistanceMilliohms: 18,
        now,
      },
      {
        id: "c",
        label: "C3",
        status: "active",
        measuredAt: new Date(now).toISOString(),
        voltage: 12.6,
        resistanceMilliohms: 22,
        now,
      },
    ]);

    expect(fleet.activeCount).toBe(2);
    expect(fleet.readyCount).toBe(1);
    expect(fleet.serviceCount).toBe(1);
    expect(fleet.retireHealthCount).toBe(1);

    const flags = batteryPitFlags(fleet, orgId);
    expect(flags.some((f) => /retire/i.test(f.title))).toBe(true);

    const fmea = batteryFmeaSignals(fleet, orgId);
    expect(fmea.some((s) => s.id === "battery-retire-wear")).toBe(true);
  });

  it("flags empty fleet without inventing readiness", () => {
    const fleet = summarizeFleet([]);
    expect(batteryPitFlags(fleet, orgId)[0]?.title).toMatch(/No batteries/i);
    expect(batteryFmeaSignals(fleet, orgId)).toEqual([]);
  });
});
