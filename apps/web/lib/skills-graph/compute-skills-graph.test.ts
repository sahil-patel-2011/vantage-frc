import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSkillsGraphView, requestMentor } from "./compute-skills-graph";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const MENTOR = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSkillsGraphView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSkillsGraphView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with entries, task evidence, and ranked mentor candidates for open requests", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM memberships m") && sql.includes("JOIN users u") && sql.includes("ORDER BY u.name")) {
        return {
          rows: [
            { userId: USER, userName: "Nova Novice" },
            { userId: MENTOR, userName: "Mira Mentor" },
          ],
        };
      }
      if (sql.includes("FROM skills_graph_entries")) {
        return {
          rows: [
            {
              id: "entry-1",
              userId: MENTOR,
              userName: "Mira Mentor",
              skillCategory: "drivetrain",
              customLabel: null,
              proficiency: "expert",
              evidenceNote: "Led drivetrain build 3 seasons running",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM build_tasks")) {
        return {
          rows: [{ userName: "Mira Mentor", skillCategory: "drivetrain", completedCount: "6" }],
        };
      }
      if (sql.includes("FROM skills_graph_mentor_requests")) {
        return {
          rows: [
            {
              id: "req-1",
              requesterUserId: USER,
              requesterName: "Nova Novice",
              skillCategory: "drivetrain",
              note: "Want to learn swerve assembly",
              status: "open",
              matchedUserId: null,
              matchedUserName: null,
              matchedRationale: null,
              createdAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeSkillsGraphView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]!.taskEvidenceCount).toBe(6);
    expect(view.summary.totalEntries).toBe(1);
    expect(view.requests).toHaveLength(1);
    expect(view.requests[0]!.candidates[0]!.userId).toBe(MENTOR);
    expect(view.requests[0]!.candidates[0]!.taskEvidenceCount).toBe(6);
    // No learning_predictions rows -> honest empty calibration, never a zeroed table.
    expect(view.calibration).toEqual([]);
  });

  it("surfaces Call Your Shot calibration as evidence with proposals only above threshold", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, role: "owner" }] };
      }
      if (sql.includes("FROM learning_predictions")) {
        return {
          rows: [
            {
              userId: USER,
              userName: "Nova Novice",
              surface: "gearbox",
              scored: "7",
              spotOn: "6",
              close: "1",
              off: "0",
              skipped: "1",
              lastCallAt: "2026-03-01T00:00:00.000Z",
            },
            {
              userId: MENTOR,
              userName: "Mira Mentor",
              surface: "power_budget",
              scored: "2",
              spotOn: "2",
              close: "0",
              off: "0",
              skipped: "0",
              lastCallAt: "2026-03-02T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeSkillsGraphView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.viewerCanCountersign).toBe(true);
    expect(view.calibration).toHaveLength(2);
    const strong = view.calibration.find((s) => s.userId === USER)!;
    expect(strong.proposal?.skillCategory).toBe("mechanical_design");
    const thin = view.calibration.find((s) => s.userId === MENTOR)!;
    expect(thin.proposal).toBeNull();
    expect(thin.note).toContain("Not enough graded calls yet");
  });
});

describe("requestMentor", () => {
  it("ranks candidates deterministically and persists a matched request when a candidate exists", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM skills_graph_entries e")) {
        return {
          rows: [
            {
              id: "entry-1",
              userId: MENTOR,
              userName: "Mira Mentor",
              skillCategory: "software",
              customLabel: null,
              proficiency: "proficient",
              evidenceNote: "Wrote autonomous routines",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM build_tasks")) {
        return { rows: [{ userName: "Mira Mentor", skillCategory: "software", completedCount: "3" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO skills_graph_mentor_requests")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await requestMentor(client, { orgId: ORG, userId: USER, skillCategory: "software", note: "Need onramp help" });

    const requestInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO skills_graph_mentor_requests"));
    expect(requestInsert).toBeDefined();
    expect(requestInsert?.params).toContain("matched");
    expect(requestInsert?.params).toContain(MENTOR);

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
