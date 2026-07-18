import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMockJudgingView, runSession } from "./compute-mock-judging";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMockJudgingView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMockJudgingView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from prep notes, sessions, and readiness", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM mock_judging_prep_notes") && sql.includes("SELECT id, title, note")) {
        return {
          rows: [
            {
              id: NOTE_ID,
              title: "STEM night reach",
              note: "We ran a STEM outreach night reaching 300 local elementary students.",
              awardCategory: "impact",
              tags: ["outreach", "stem"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM mock_judging_sessions") && sql.includes("SELECT id, season_year")) {
        return {
          rows: [
            {
              id: "session-1",
              seasonYear: 2026,
              awardCategory: "impact",
              question: "Tell me about an outreach event your team ran this season and its measurable impact.",
              answerText: "We ran a STEM outreach night reaching 300 local elementary students.",
              criteriaScores: {
                substance: 4,
                specificity: 4,
                evidence_grounding: 4,
                clarity: 4,
                confidence: 4,
              },
              overallScore: "4.00",
              strengths: ["Strong substance"],
              improvements: [],
              feedback: "Overall 4/5 — a strong, judge-ready answer.",
              createdAt: "2026-02-02T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeMockJudgingView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.notes).toHaveLength(1);
    expect(view.sessions).toHaveLength(1);
    expect(view.sessions[0]?.overallScore).toBe(4);
    expect(view.readiness.totalSessions).toBe(1);
    expect(view.readiness.strongSessionCount).toBe(1);
    expect(view.readiness.notesCount).toBe(1);
  });
});

describe("runSession", () => {
  it("scores an answer grounded in logged prep notes and persists a session", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM mock_judging_prep_notes")) {
        return {
          rows: [
            {
              id: NOTE_ID,
              title: "STEM night reach",
              note: "We ran a STEM outreach night reaching 300 local elementary students in February.",
              awardCategory: "impact",
              tags: ["outreach", "stem"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "0" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO mock_judging_sessions")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await runSession(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      awardCategory: "impact",
      question: null,
      answerText:
        "We ran a STEM outreach night reaching 300 local elementary students in February, teaching hands-on robotics activities to build early interest in engineering.",
    });

    const sessionInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO mock_judging_sessions"));
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.params?.[0]).toBe(ORG);

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });

  it("scores an empty answer as zero across every criterion", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM mock_judging_prep_notes")) return { rows: [] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes("INSERT INTO mock_judging_sessions") || sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await runSession(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      awardCategory: "general",
      question: "Tell me about your team.",
      answerText: "   ",
    });

    const sessionInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO mock_judging_sessions"));
    expect(sessionInsert).toBeDefined();
    // overall_score is the 7th positional param in the insert.
    expect(sessionInsert?.params?.[6]).toBe(0);
  });
});
