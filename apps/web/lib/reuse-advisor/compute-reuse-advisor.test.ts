import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeReuseAdvisorView, recordAssessment } from "./compute-reuse-advisor";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SUBSYSTEM_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeReuseAdvisorView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeReuseAdvisorView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with candidates and assessments built from subsystem/FMEA/review history", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM robot_subsystems") && sql.includes("DISTINCT ON")) {
        return {
          rows: [
            {
              id: SUBSYSTEM_ID,
              name: "Intake",
              category: "intake",
              seasonYear: 2025,
              motorType: "Falcon 500",
              motorCount: 2,
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [{ key: "intake", total: "4", highSeverityOrPassed: "2" }],
        };
      }
      if (sql.includes("FROM design_reviews")) {
        return {
          rows: [{ key: "intake", total: "2", highSeverityOrPassed: "1" }],
        };
      }
      if (sql.includes("FROM reuse_advisor_assessments") && sql.includes("DISTINCT lower")) {
        return { rows: [] };
      }
      if (sql.includes("FROM reuse_advisor_assessments") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2025 }] };
      }
      return { rows: [] };
    });

    const view = await computeReuseAdvisorView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.candidates).toHaveLength(1);
    const candidate = view.candidates[0]!;
    expect(candidate.subsystemName).toBe("Intake");
    expect(candidate.fmeaFailureCount).toBe(4);
    expect(candidate.fmeaHighSeverityCount).toBe(2);
    // Chronic (>=3) failures with high-severity history -> avoid.
    expect(candidate.recommendation).toBe("avoid");
    expect(candidate.alreadyAssessed).toBe(false);
    expect(view.assessments).toHaveLength(0);
    expect(view.seasons).toContain(2026);
  });
});

describe("recordAssessment", () => {
  it("computes and persists a deterministic recommendation grounded in FMEA/review history", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("count(*)::text AS total, count(*) FILTER (WHERE severity >= 7)")) {
        return { rows: [{ total: "0", highSeverity: "0" }] };
      }
      if (sql.includes("count(*)::text AS total, count(*) FILTER (WHERE status = 'complete')")) {
        return { rows: [{ total: "2", passed: "2" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO reuse_advisor_assessments")) {
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
      subsystemName: "Climber",
      category: "climber",
      sourceSeasonYear: 2025,
      notes: null,
    });

    const assessmentInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO reuse_advisor_assessments"));
    expect(assessmentInsert).toBeDefined();
    // No FMEA failures + fully passed reviews -> reuse.
    expect(assessmentInsert?.params).toContain("reuse");

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
