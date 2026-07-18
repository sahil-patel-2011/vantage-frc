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
  it("maps quarantine ↔ service for pit UI", () => {
    expect(packStatusToPit("quarantine")).toBe("service");
    expect(pitStatusToPack("service")).toBe("quarantine");
  });

  it("classifies match-ready packs with freshness", () => {
    expect(
      classifyMatchReady({
        status: "active",
        voltage: 12.7,
        resistanceMilliohms: 19,
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
        resistanceMilliohms: 24,
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
