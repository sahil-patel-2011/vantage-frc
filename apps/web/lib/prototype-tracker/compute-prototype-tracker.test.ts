import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computePrototypeTrackerView, draftDecisionForTest } from "./compute-prototype-tracker";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const TEST_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computePrototypeTrackerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePrototypeTrackerView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from tests and linked decisions", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM prototype_tracker_tests") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: TEST_ID,
              seasonYear: 2026,
              subsystemName: "Climber",
              title: "Latch v2 load test",
              hypothesis: "Latch v2 holds full robot weight without slipping",
              testDate: "2026-02-01",
              outcome: "success",
              resultSummary: "Held 140lb for 30s with no slip",
              metricLabel: "Hold time (s)",
              metricValue: "30.00",
              metricTarget: "20.00",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM prototype_tracker_decisions")) {
        return {
          rows: [
            {
              id: "decision-1",
              testId: TEST_ID,
              decisionTitle: "Adopt latch v2 for climber",
              recommendation: "adopt",
              confidence: "0.780",
              decisionRecord: "Decision: Adopt — Climber: Latch v2 load test.",
              notebookEntry: "## Climber — Latch v2 load test",
              status: "draft",
              createdAt: "2026-02-01T00:05:00.000Z",
              updatedAt: "2026-02-01T00:05:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computePrototypeTrackerView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]?.outcome).toBe("success");
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]?.recommendation).toBe("adopt");
  });
});

describe("draftDecisionForTest", () => {
  it("drafts and persists a deterministic decision record + notebook entry grounded in the test", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM prototype_tracker_tests WHERE id")) {
        return {
          rows: [
            {
              id: TEST_ID,
              seasonYear: 2026,
              subsystemName: "Climber",
              title: "Latch v2 load test",
              hypothesis: "Latch v2 holds full robot weight without slipping",
              testDate: "2026-02-01",
              outcome: "success",
              resultSummary: "Held 140lb for 30s with no slip",
              metricLabel: "Hold time (s)",
              metricValue: "30.00",
              metricTarget: "20.00",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO prototype_tracker_decisions")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await draftDecisionForTest(client, {
      orgId: ORG,
      userId: USER,
      testId: TEST_ID,
      decisionTitle: "Adopt latch v2 for climber",
    });

    const decisionInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO prototype_tracker_decisions"));
    expect(decisionInsert).toBeDefined();
    // Success outcome with metric above target -> adopt.
    expect(decisionInsert?.params).toContain("adopt");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });

  it("throws when the referenced test does not exist", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM prototype_tracker_tests WHERE id")) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      draftDecisionForTest(client, { orgId: ORG, userId: USER, testId: "missing", decisionTitle: "x" }),
    ).rejects.toThrow("Prototype test not found");
  });
});
