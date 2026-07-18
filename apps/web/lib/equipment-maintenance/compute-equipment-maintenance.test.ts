import { describe, expect, it } from "vitest";
import { buildAssetView, summarizeEquipment } from ".";
import { computeEquipmentMaintenanceView } from "./compute-equipment-maintenance";
import type { EquipmentAsset, MaintenanceLog } from "./types";

type QueryCall = { text: string; params: unknown[] };

function makeMockClient(rowsByCall: unknown[][]) {
  const calls: QueryCall[] = [];
  let callIndex = 0;
  return {
    client: {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        const rows = rowsByCall[callIndex] ?? [];
        callIndex += 1;
        return { rows, rowCount: rows.length };
      },
    },
    calls,
  };
}

describe("computeEquipmentMaintenanceView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient([[]]);
    const view = await computeEquipmentMaintenanceView(client as never, {
      userId: "user-1",
      requestedOrg: null,
    });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no equipment assets yet", async () => {
    const { client } = makeMockClient([
      [{ orgId: "org-1", teamNumber: 254 }], // resolveOrg
      [], // assets
      [], // logs
    ]);
    const view = await computeEquipmentMaintenanceView(client as never, {
      userId: "user-1",
      requestedOrg: "org-1",
    });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe("org-1");
    }
  });

  it("returns a live summary over mock asset + log rows", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const staleDate = "2020-01-01";
    const { client } = makeMockClient([
      [{ orgId: "org-1", teamNumber: 254 }], // resolveOrg
      [
        {
          id: "asset-1",
          name: "CNC Router",
          category: "cnc",
          location: "Shop bay 1",
          intervalDays: 30,
          notes: null,
          active: true,
        },
        {
          id: "asset-2",
          name: "Drill Press",
          category: "drill_press",
          location: null,
          intervalDays: null,
          notes: null,
          active: true,
        },
      ], // assets
      [
        {
          id: "log-1",
          assetId: "asset-1",
          performedOn: staleDate,
          action: "routine",
          minutesSpent: 45,
          notes: "Lubricated rails",
        },
      ], // logs
    ]);

    const view = await computeEquipmentMaintenanceView(client as never, {
      userId: "user-1",
      requestedOrg: "org-1",
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.assets).toHaveLength(2);
    expect(view.summary.totalAssets).toBe(2);
    expect(view.summary.totalLogs).toBe(1);
    expect(view.summary.totalMinutesLogged).toBe(45);

    const cnc = view.assets.find((a) => a.id === "asset-1");
    expect(cnc?.status).toBe("overdue");
    expect(cnc?.lastPerformedOn).toBe(staleDate);

    const drillPress = view.assets.find((a) => a.id === "asset-2");
    expect(drillPress?.status).toBe("unscheduled");
    void today;
  });
});

describe("buildAssetView + summarizeEquipment (pure helpers)", () => {
  const today = "2026-07-18";

  it("marks an asset with no interval as unscheduled", () => {
    const asset: EquipmentAsset = {
      id: "a1",
      name: "Bench Vise",
      category: "hand_tool",
      location: null,
      intervalDays: null,
      notes: null,
      active: true,
    };
    const view = buildAssetView(asset, [], today);
    expect(view.status).toBe("unscheduled");
    expect(view.nextDueOn).toBeNull();
  });

  it("marks an asset overdue when the interval has elapsed since the last log", () => {
    const asset: EquipmentAsset = {
      id: "a1",
      name: "3D Printer",
      category: "printer_3d",
      location: "Design lab",
      intervalDays: 14,
      notes: null,
      active: true,
    };
    const logs: MaintenanceLog[] = [
      { id: "l1", assetId: "a1", performedOn: "2026-06-01", action: "cleaning", minutesSpent: 20, notes: null },
    ];
    const view = buildAssetView(asset, logs, today);
    expect(view.status).toBe("overdue");
    expect(view.logCount).toBe(1);

    const summary = summarizeEquipment([view], logs);
    expect(summary.overdueCount).toBe(1);
    expect(summary.totalMinutesLogged).toBe(20);
  });

  it("marks an asset ok when recently serviced within its interval", () => {
    const asset: EquipmentAsset = {
      id: "a1",
      name: "Mill",
      category: "mill",
      location: null,
      intervalDays: 30,
      notes: null,
      active: true,
    };
    const logs: MaintenanceLog[] = [
      { id: "l1", assetId: "a1", performedOn: "2026-07-15", action: "routine", minutesSpent: 10, notes: null },
    ];
    const view = buildAssetView(asset, logs, today);
    expect(view.status).toBe("ok");
  });
});
