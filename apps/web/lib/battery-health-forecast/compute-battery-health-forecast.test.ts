import { describe, expect, it, vi } from "vitest";
import { computeBatteryHealthForecastView } from "./compute-battery-health-forecast";

type QueryCall = { text: string; values: unknown[] };

function makeClient(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: QueryCall[] = [];
  let index = 0;
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { rowCount: response.rows.length, ...response };
    }),
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeBatteryHealthForecastView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeBatteryHealthForecastView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns live empty fleet when the org has no registered batteries", async () => {
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      { rows: [] },
      { rows: [] },
    ]);

    const view = await computeBatteryHealthForecastView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.batteries).toEqual([]);
      expect(view.forecasts).toEqual([]);
      expect(view.summary.totalBatteries).toBe(0);
    }
  });

  it("computes a live fleet forecast with a rising IR trend from mock rows", async () => {
    const now = new Date("2026-07-18T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const t0 = new Date(now.getTime() - 30 * day).toISOString();
    const t1 = new Date(now.getTime() - 20 * day).toISOString();
    const t2 = new Date(now.getTime() - 10 * day).toISOString();
    const t3 = now.toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "battery-worsening",
            label: "Battery A",
            serialNumber: "SN-A",
            status: "active",
            putInServiceOn: "2026-01-01",
            retiredOn: null,
            notes: null,
            createdAt: t0,
          },
          {
            id: "battery-flat",
            label: "Battery B",
            serialNumber: "SN-B",
            status: "active",
            putInServiceOn: "2026-01-01",
            retiredOn: null,
            notes: null,
            createdAt: t0,
          },
          {
            id: "battery-no-readings",
            label: "Battery C",
            serialNumber: null,
            status: "active",
            putInServiceOn: null,
            retiredOn: null,
            notes: null,
            createdAt: t0,
          },
        ],
      },
      {
        rows: [
          {
            id: "r1",
            batteryId: "battery-worsening",
            recordedAt: t0,
            cycleCount: 10,
            internalResistanceMohm: "10.00",
            voltage: "12.90",
            notes: null,
          },
          {
            id: "r2",
            batteryId: "battery-worsening",
            recordedAt: t1,
            cycleCount: 40,
            internalResistanceMohm: "13.00",
            voltage: "12.80",
            notes: null,
          },
          {
            id: "r3",
            batteryId: "battery-worsening",
            recordedAt: t2,
            cycleCount: 70,
            internalResistanceMohm: "16.00",
            voltage: "12.60",
            notes: null,
          },
          {
            id: "r4",
            batteryId: "battery-worsening",
            recordedAt: t3,
            cycleCount: 100,
            internalResistanceMohm: "19.00",
            voltage: "12.40",
            notes: "Sagging under load",
          },
          {
            id: "r5",
            batteryId: "battery-flat",
            recordedAt: t0,
            cycleCount: 5,
            internalResistanceMohm: "8.00",
            voltage: "13.00",
            notes: null,
          },
          {
            id: "r6",
            batteryId: "battery-flat",
            recordedAt: t2,
            cycleCount: 15,
            internalResistanceMohm: "8.10",
            voltage: "13.00",
            notes: null,
          },
          {
            id: "r7",
            batteryId: "battery-flat",
            recordedAt: t3,
            cycleCount: 25,
            internalResistanceMohm: "8.00",
            voltage: "13.00",
            notes: null,
          },
        ],
      },
    ]);

    const view = await computeBatteryHealthForecastView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.batteries).toHaveLength(3);
    expect(view.forecasts).toHaveLength(3);

    const worsening = view.forecasts.find((f) => f.batteryId === "battery-worsening");
    expect(worsening).toBeDefined();
    expect(worsening?.resistanceSlopePerCycle).not.toBeNull();
    expect(worsening?.resistanceSlopePerCycle ?? 0).toBeGreaterThan(0);
    expect(worsening?.projectedRetirementCycle).not.toBeNull();
    expect(["watch", "retire_soon", "overdue"]).toContain(worsening?.forecastStatus);

    const flat = view.forecasts.find((f) => f.batteryId === "battery-flat");
    expect(flat?.projectedRetirementDate).toBeNull();

    const noReadings = view.forecasts.find((f) => f.batteryId === "battery-no-readings");
    expect(noReadings?.readingsCount).toBe(0);
    expect(noReadings?.forecastStatus).toBe("insufficient_data");

    expect(view.summary.totalBatteries).toBe(3);
    expect(view.summary.activeBatteries).toBe(3);
    expect(view.summary.fleetReadiness).toBeGreaterThanOrEqual(0);
    expect(view.summary.fleetReadiness).toBeLessThanOrEqual(1);
  });
});
