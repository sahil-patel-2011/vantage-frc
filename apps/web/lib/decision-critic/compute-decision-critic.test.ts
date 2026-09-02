import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeDecisionCriticView, logReview } from "./compute-decision-critic";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const FMEA_ID = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeDecisionCriticView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeDecisionCriticView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from reviews, weight/power headroom, and recent decisions", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM decision_critic_reviews") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "review-1",
              seasonYear: 2026,
              subsystemName: "Climber",
              title: "Add telescoping climber stage",
              proposal: "Add a third telescoping stage for a higher climb.",
              category: "design",
              weightAddedLbs: "6.00",
              weightMarginLbs: "4.00",
              powerAddedAmps: "10.00",
              powerHeadroomAmps: "20.00",
              chronicFailureCount: 2,
              priorRejectedCount: 1,
              verdict: "reconsider",
              confidence: "0.72",
              concerns: ["Adding 6 lb exceeds the remaining weight margin (4 lb) by 2 lb."],
              recommendation: "Resolve the exceeded margin(s) above before committing to this decision.",
              relatedFmeaFailureIds: [FMEA_ID],
              relatedDecisionIds: [DECISION_ID],
              outcome: "open",
              createdAt: "2026-02-01T00:00:00.000Z",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM weight_components")) {
        return { rows: [{ total: "115.00" }] };
      }
      if (sql.includes("FROM weight_settings")) {
        return { rows: [{ limitLbs: "125.00" }] };
      }
      if (sql.includes("FROM power_loads")) {
        return { rows: [{ totalPeak: "80.00", totalBreaker: "100.00" }] };
      }
      if (sql.includes("FROM decision_records") && sql.includes("SELECT id, title")) {
        return {
          rows: [
            {
              id: DECISION_ID,
              title: "Two-stage climber",
              status: "accepted",
              decidedOn: "2026-01-10",
              rationale: "Simpler and lighter.",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeDecisionCriticView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.reviews).toHaveLength(1);
    expect(view.reviews[0]?.verdict).toBe("reconsider");
    expect(view.weightHeadroom.marginLbs).toBe(10);
    expect(view.powerHeadroom.headroomAmps).toBe(20);
    expect(view.recentDecisions).toHaveLength(1);
  });
});

describe("logReview", () => {
  it("computes and persists a grounded critique from weight/power headroom, FMEA history, and prior decisions", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM weight_components")) {
        return { rows: [{ total: "123.00" }] };
      }
      if (sql.includes("FROM weight_settings")) {
        return { rows: [{ limitLbs: "125.00" }] };
      }
      if (sql.includes("FROM power_loads")) {
        return { rows: [{ totalPeak: "95.00", totalBreaker: "100.00" }] };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            {
              id: FMEA_ID,
              title: "Climber cable snapped",
              subsystemName: "Climber",
              occurredAt: "2026-01-05",
              severity: 7,
              occurrence: 5,
              detection: 4,
              status: "open",
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              title: "Climber motor stalled",
              subsystemName: "Climber",
              occurredAt: "2026-01-20",
              severity: 6,
              occurrence: 4,
              detection: 3,
              status: "closed",
            },
          ],
        };
      }
      if (sql.includes("FROM decision_records")) {
        return { rows: [{ id: DECISION_ID }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO decision_critic_reviews")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await logReview(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      subsystemName: "Climber",
      title: "Add telescoping climber stage",
      proposal: "Add a third telescoping stage for a higher climb.",
      category: "design",
      weightAddedLbs: 4,
      powerAddedAmps: 3,
    });

    const reviewInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO decision_critic_reviews"));
    expect(reviewInsert).toBeDefined();
    // Only 2 lb weight margin left (125 - 123) and this adds 4 lb -> exceeds margin -> reconsider.
    expect(reviewInsert?.params).toContain("reconsider");
    // 2 prior FMEA failures on Climber -> chronic_failure_count = 2.
    expect(reviewInsert?.params).toContain(2);
    // 1 prior rejected/superseded decision matched -> prior_rejected_count = 1.
    expect(reviewInsert?.params).toContain(1);

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
