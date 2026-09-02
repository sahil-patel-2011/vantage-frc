import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSpareRobotKitView, generateChecklist } from "./compute-spare-robot-kit";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSpareRobotKitView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSpareRobotKitView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with candidate items built from inventory spares x FMEA history", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Falcon 500 spare",
              category: "spare",
              subsystem: "Drivetrain",
              quantity: "1.00",
              unitCost: "220.00",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return { rows: [{ subsystemName: "Drivetrain", failureCount: "5", avgRpn: "180.00" }] };
      }
      if (sql.includes("FROM spare_robot_kit_checklists") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeSpareRobotKitView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.candidateItems).toHaveLength(1);
    expect(view.candidateItems[0]?.itemName).toBe("Falcon 500 spare");
    expect(view.candidateItems[0]?.priority).toBe("critical");
    expect(view.candidateItems[0]?.recommendedQty).toBeGreaterThan(0);
    expect(view.checklists).toHaveLength(0);
  });
});

describe("generateChecklist", () => {
  it("computes and persists a checklist grounded in candidate items", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            {
              id: ITEM_ID,
              name: "Falcon 500 spare",
              category: "spare",
              subsystem: "Drivetrain",
              quantity: "0.00",
              unitCost: "220.00",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures") && sql.includes("GROUP BY")) {
        return { rows: [{ subsystemName: "Drivetrain", failureCount: "8", avgRpn: "90.00" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO spare_robot_kit_checklists")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await generateChecklist(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      title: "Week 3 kit",
    });

    const checklistInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO spare_robot_kit_checklists"));
    expect(checklistInsert).toBeDefined();
    const itemsJson = checklistInsert?.params[3] as string;
    const items = JSON.parse(itemsJson) as Array<{ itemId: string; priority: string; recommendedQty: number }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.itemId).toBe(ITEM_ID);
    expect(items[0]?.priority).toBe("recommended");
    expect(items[0]?.recommendedQty).toBeGreaterThan(0);

    // The render is metered under the feature when a model answers (ai_usage_events), and every
    // attempt — model or template fallback — is recorded in ai_render_attempts (0498).
    const usageInsert = inserted.find(
      (entry) => entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts"),
    );
    expect(usageInsert).toBeDefined();
  });
});
