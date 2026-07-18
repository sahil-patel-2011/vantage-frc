import { describe, expect, it, vi } from "vitest";
import { computeBatteryRotationView } from "./compute-battery-rotation";

type QueryCall = { text: string; values: unknown[] };

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: QueryCall[] = [];
  let index = 0;
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    }),
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeBatteryRotationView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeBatteryRotationView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes a live rotation summary with health, trend, and charge feasibility from mock rows", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const later = now.toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "battery-healthy",
            label: "Battery A",
            serialNumber: "SN-A",
            status: "active",
            purchasedOn: "2025-01-01",
            notes: null,
            createdAt: earlier,
          },
          {
            id: "battery-short",
            label: "Battery B",
            serialNumber: "SN-B",
            status: "active",
            purchasedOn: "2025-01-01",
            notes: null,
            createdAt: earlier,
          },
          {
            id: "battery-no-readings",
            label: "Battery C",
            serialNumber: null,
            status: "active",
            purchasedOn: null,
            notes: null,
            createdAt: earlier,
          },
        ],
      },
      {
        rows: [
          {
            id: "reading-1",
            batteryId: "battery-healthy",
            recordedAt: earlier,
            internalResistanceMohm: "10.00",
            voltage: "12.90",
            cycleCount: 5,
            notes: null,
          },
          {
            id: "reading-2",
            batteryId: "battery-healthy",
            recordedAt: later,
            internalResistanceMohm: "9.00",
            voltage: "12.95",
            cycleCount: 6,
            notes: null,
          },
          {
            id: "reading-3",
            batteryId: "battery-short",
            recordedAt: earlier,
            internalResistanceMohm: "12.00",
            voltage: "12.60",
            cycleCount: 40,
            notes: null,
          },
          {
            id: "reading-4",
            batteryId: "battery-short",
            recordedAt: later,
            internalResistanceMohm: "25.00",
            voltage: "12.10",
            cycleCount: 41,
            notes: "Sagging under load",
          },
        ],
      },
      {
        rows: [
          {
            id: "assignment-1",
            batteryId: "battery-healthy",
            batteryLabel: "Battery A",
            matchLabel: "Qual 12",
            scheduledAt: later,
            chargeMinutesAvailable: 100,
          },
          {
            id: "assignment-2",
            batteryId: "battery-short",
            batteryLabel: "Battery B",
            matchLabel: "Qual 13",
            scheduledAt: later,
            chargeMinutesAvailable: 15,
          },
        ],
      },
    ]);

    const view = await computeBatteryRotationView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.batteries).toHaveLength(3);

    const healthy = view.batteries.find((b) => b.batteryId === "battery-healthy");
    expect(healthy?.trend).toBe("improving");
    expect(healthy?.shortPackAlert).toBe(false);

    const shortPack = view.batteries.find((b) => b.batteryId === "battery-short");
    expect(shortPack?.trend).toBe("worsening");
    expect(shortPack?.shortPackAlert).toBe(true);

    const noReadings = view.batteries.find((b) => b.batteryId === "battery-no-readings");
    expect(noReadings?.readingsCount).toBe(0);
    expect(noReadings?.trend).toBe("unknown");

    expect(view.slots).toHaveLength(2);
    const slotForShortPack = view.slots.find((s) => s.batteryId === "battery-short");
    expect(slotForShortPack?.chargeSufficient).toBe(false);
    expect(slotForShortPack?.batteryAlert).toBe(true);

    expect(view.summary.totalBatteries).toBe(3);
    expect(view.summary.shortPackCount).toBe(1);
    expect(view.summary.chargeShortfallCount).toBe(1);
    expect(view.summary.planReadiness).toBeGreaterThanOrEqual(0);
    expect(view.summary.planReadiness).toBeLessThanOrEqual(1);
  });
});
