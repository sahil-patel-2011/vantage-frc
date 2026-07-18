import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeRuleImpactView, recordAssessment } from "./compute-rule-impact";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SUBSYSTEM_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeRuleImpactView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeRuleImpactView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view diffing logged rule changes against the subsystem library", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM robot_subsystems") && sql.includes("DISTINCT ON")) {
        return {
          rows: [
            {
              id: SUBSYSTEM_ID,
              name: "Climber",
              category: "climber",
              seasonYear: 2025,
              motorType: "Falcon 500",
              motorCount: 1,
            },
          ],
        };
      }
      if (sql.includes("FROM rule_impact_rule_changes") && sql.includes("SELECT id, season_year")) {
        return {
          rows: [
            {
              id: RULE_ID,
              seasonYear: 2026,
              ruleCode: "R301",
              title: "Cage height reduced",
              category: "dimension",
              severity: "blocking",
              subsystemCategory: "climber",
              summary: "The climb cage height dropped 6 inches.",
              sourceUrl: null,
              createdAt: "2026-01-04T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM rule_impact_assessments") && sql.includes("DISTINCT lower")) {
        return { rows: [] };
      }
      if (sql.includes("FROM rule_impact_assessments") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2025 }] };
      }
      return { rows: [] };
    });

    const view = await computeRuleImpactView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.ruleChanges).toHaveLength(1);
    expect(view.candidates).toHaveLength(1);
    const candidate = view.candidates[0]!;
    expect(candidate.subsystemName).toBe("Climber");
    expect(candidate.matchedRuleCount).toBe(1);
    expect(candidate.blockingRuleCount).toBe(1);
    // A blocking rule change targeting this subsystem's category -> blocked.
    expect(candidate.impactStatus).toBe("blocked");
    expect(candidate.alreadyAssessed).toBe(false);
    expect(view.assessments).toHaveLength(0);
    expect(view.seasons).toContain(2026);
  });
});

describe("recordAssessment", () => {
  it("computes and persists a deterministic impact call grounded in matched rule changes", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM rule_impact_rule_changes") && sql.includes("SELECT severity")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO rule_impact_assessments")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await recordAssessment(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      subsystemId: SUBSYSTEM_ID,
      subsystemName: "Intake",
      category: "intake",
      sourceSeasonYear: 2025,
      notes: null,
    });

    const assessmentInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO rule_impact_assessments"));
    expect(assessmentInsert).toBeDefined();
    // No matched rule changes -> still legal.
    expect(assessmentInsert?.params).toContain("still_legal");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
