import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeJudgeSimView, runSession } from "./compute-judge-sim";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeJudgeSimView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeJudgeSimView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.some((s) => s.href.includes("/business?tab=impact"))).toBe(true);
      expect(view.steps.some((s) => s.href.includes("/business?tab=impact-essay"))).toBe(true);
      expect(view.steps.some((s) => s.href.includes("/business?tab=evidence"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      expect(view.steps.every((s) => /never DEMO|org-scoped|real|blank/i.test(s.detail))).toBe(true);
    }
  });

  it("returns a live view built from evidence, sessions, and readiness", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM judge_sim_evidence") && sql.includes("SELECT id, title, claim")) {
        return {
          rows: [
            {
              id: EVIDENCE_ID,
              title: "Regional STEM night",
              claim: "We ran a STEM outreach night reaching 300 local elementary students.",
              category: "outreach",
              sourceUrl: null,
              occurredOn: "2026-02-01",
              tags: ["outreach", "stem"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM judge_sim_sessions") && sql.includes("SELECT id, season_year")) {
        return {
          rows: [
            {
              id: "session-1",
              seasonYear: 2026,
              category: "outreach",
              question: "Tell me about an outreach event your team ran this season and its impact.",
              answerText: "We ran a STEM outreach night reaching 300 local elementary students.",
              verdict: "well_backed",
              confidence: "0.9",
              backedClaims: ["We ran a STEM outreach night reaching 300 local elementary students."],
              flaggedClaims: [],
              matchedEvidenceIds: [EVIDENCE_ID],
              feedback: "1/1 claims are backed by logged evidence.",
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

    const view = await computeJudgeSimView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.evidence).toHaveLength(1);
    expect(view.sessions).toHaveLength(1);
    expect(view.sessions[0]?.verdict).toBe("well_backed");
    expect(view.readiness.totalSessions).toBe(1);
    expect(view.readiness.wellBackedCount).toBe(1);
    expect(view.readiness.evidenceCount).toBe(1);
  });
});

describe("runSession", () => {
  it("grades an answer against logged evidence and persists a well_backed verdict", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM judge_sim_evidence")) {
        return {
          rows: [
            {
              id: EVIDENCE_ID,
              title: "Regional STEM night",
              claim: "We ran a STEM outreach night reaching 300 local elementary students.",
              category: "outreach",
              sourceUrl: null,
              occurredOn: "2026-02-01",
              tags: ["outreach", "stem"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "0" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO judge_sim_sessions")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await runSession(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      category: "outreach",
      question: null,
      answerText: "We ran a STEM outreach night reaching 300 local elementary students.",
    });

    const sessionInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO judge_sim_sessions"));
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.params).toContain("well_backed");

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });

  it("flags an unbacked claim when no evidence is logged", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM judge_sim_evidence")) {
        return { rows: [] };
      }
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "0" }] };
      }
      if (sql.includes("INSERT INTO judge_sim_sessions") || (sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await runSession(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      category: "technical",
      question: "What is the biggest technical challenge your team faced this build season?",
      answerText: "Our swerve modules kept slipping during autonomous routines this season.",
    });

    const sessionInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO judge_sim_sessions"));
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.params).toContain("unbacked");
  });
});
