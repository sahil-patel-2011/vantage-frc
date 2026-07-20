import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeCadChangeRadarView, recordSnapshot } from "./compute-cad-change-radar";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCadChangeRadarView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCadChangeRadarView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when no connected Onshape workspace exists", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM cad_connections")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCadChangeRadarView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps.some((step) => step.id === "cad")).toBe(true);
    }
  });

  it("returns a live view with the latest snapshot per part, diffs, subscriptions, and notifications", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM cad_connections")) {
        return { rows: [{ id: CONNECTION, label: "Team Onshape", status: "connected" }] };
      }
      if (sql.includes("FROM cad_change_radar_snapshots") && sql.includes("DISTINCT ON")) {
        return {
          rows: [
            {
              id: "snap-2",
              partKey: "intake-plate",
              partName: "Intake Plate",
              revision: "R3",
              params: { envelope_length_mm: 320, mass_kg: 1.2 },
              massKg: "1.2",
              capturedAt: "2026-07-10T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM cad_change_radar_diffs")) {
        return {
          rows: [
            {
              id: "diff-1",
              partKey: "intake-plate",
              partName: "Intake Plate",
              fromRevision: "R2",
              toRevision: "R3",
              changedParams: [{ key: "mass_kg", fromValue: 1.0, toValue: 1.2, percentChange: 20 }],
              severity: "major",
              aiSummary: null,
              createdAt: "2026-07-10T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM cad_change_radar_subscriptions")) {
        return {
          rows: [
            {
              id: "sub-1",
              userId: USER,
              userName: "Alex",
              partKey: "intake-plate",
              subsystem: "intake",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM cad_change_radar_notifications")) {
        return {
          rows: [
            {
              id: "notif-1",
              diffId: "diff-1",
              partKey: "intake-plate",
              partName: "Intake Plate",
              message: "Major change on Intake Plate (rev R3): mass_kg 1 → 1.2 (+20.0%).",
              severity: "major",
              acknowledgedAt: null,
              createdAt: "2026-07-10T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeCadChangeRadarView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.connection.status).toBe("connected");
    expect(view.snapshots).toHaveLength(1);
    expect(view.diffs).toHaveLength(1);
    expect(view.diffs[0]!.severity).toBe("major");
    expect(view.subscriptions).toHaveLength(1);
    expect(view.mySubscriptions).toHaveLength(1);
    expect(view.notifications).toHaveLength(1);
    expect(view.notifications[0]!.acknowledgedAt).toBeNull();
  });
});

describe("recordSnapshot", () => {
  it("diffs against the prior snapshot, classifies severity, and fans out notifications to subscribers", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM cad_change_radar_snapshots") && sql.includes("ORDER BY captured_at DESC LIMIT 1")) {
        return {
          rows: [
            {
              id: "snap-1",
              partKey: "intake-plate",
              partName: "Intake Plate",
              revision: "R2",
              params: { envelope_length_mm: 300, mass_kg: 1.0 },
              massKg: "1.0",
              capturedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO cad_change_radar_snapshots")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "snap-2" }] };
      }
      if (sql.includes("INSERT INTO cad_change_radar_diffs")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "diff-1" }] };
      }
      if (sql.includes("FROM cad_change_radar_subscriptions") && sql.includes("DISTINCT")) {
        return { rows: [{ userId: USER }] };
      }
      if (sql.includes("INSERT INTO cad_change_radar_notifications")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await recordSnapshot(client, {
      orgId: ORG,
      userId: USER,
      connectionId: CONNECTION,
      partKey: "intake-plate",
      partName: "Intake Plate",
      revision: "R3",
      params: { envelope_length_mm: 320, mass_kg: 1.2 },
      massKg: 1.2,
    });

    expect(result.diffId).toBe("diff-1");
    const diffInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO cad_change_radar_diffs"));
    expect(diffInsert).toBeDefined();
    expect(diffInsert?.params).toContain("major");

    const notifInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO cad_change_radar_notifications"));
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.params).toContain(USER);
  });

  it("skips diffing when the revision has not changed", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM cad_change_radar_snapshots") && sql.includes("ORDER BY captured_at DESC LIMIT 1")) {
        return {
          rows: [
            {
              id: "snap-1",
              partKey: "intake-plate",
              partName: "Intake Plate",
              revision: "R3",
              params: { mass_kg: 1.2 },
              massKg: "1.2",
              capturedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO cad_change_radar_snapshots")) return { rows: [{ id: "snap-2" }] };
      return { rows: [] };
    });

    const result = await recordSnapshot(client, {
      orgId: ORG,
      userId: USER,
      connectionId: CONNECTION,
      partKey: "intake-plate",
      partName: "Intake Plate",
      revision: "R3",
      params: { mass_kg: 1.2 },
      massKg: 1.2,
    });

    expect(result.diffId).toBeNull();
  });
});
