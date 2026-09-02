import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeDecisionSearchView, indexDocument, runSearch } from "./compute-decision-search";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeDecisionSearchView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeDecisionSearchView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with indexed documents, seasons, and recent queries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM decision_search_documents") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: DOC_ID,
              sourceKind: "decision",
              sourceId: "decision-1",
              title: "Switch to telescoping climber",
              body: "We evaluated a telescoping climber against a fixed hook design for climb reliability.",
              seasonYear: 2026,
              tags: ["climber", "endgame"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM decision_search_queries") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "query-1",
              queryText: "climber reliability",
              resultDocumentIds: [DOC_ID],
              resultSummary: '1 match(es) for "climber reliability" — top: Switch to telescoping climber.',
              seasonYear: 2026,
              createdAt: "2026-02-02T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeDecisionSearchView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0]?.sourceKind).toBe("decision");
    expect(view.recentQueries).toHaveLength(1);
    expect(view.lastMatches.length).toBeGreaterThan(0);
    expect(view.lastMatches[0]?.document.id).toBe(DOC_ID);
    expect(view.seasons).toContain(2026);
  });
});

describe("indexDocument", () => {
  it("upserts a document into decision_search_documents", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO decision_search_documents")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await indexDocument(client, {
      orgId: ORG,
      userId: USER,
      sourceKind: "design_review",
      sourceId: "review-1",
      title: "Intake roller review",
      body: "Reviewed roller compression for cargo intake.",
      seasonYear: 2026,
      tags: ["intake"],
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.params).toContain("Intake roller review");
  });
});

describe("runSearch", () => {
  it("ranks indexed documents against the query, logs the query, and returns a grounded summary", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM decision_search_documents")) {
        return {
          rows: [
            {
              id: DOC_ID,
              sourceKind: "decision",
              sourceId: "decision-1",
              title: "Switch to telescoping climber",
              body: "We evaluated a telescoping climber against a fixed hook design for climb reliability.",
              seasonYear: 2026,
              tags: ["climber", "endgame"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              sourceKind: "notebook_entry",
              sourceId: "notebook-1",
              title: "Drivetrain gear ratio notes",
              body: "Explored swerve gear ratio options for speed vs torque tradeoffs.",
              seasonYear: 2026,
              tags: ["drivetrain"],
              createdAt: "2026-01-15T00:00:00.000Z",
            },
          ],
        };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO decision_search_queries")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await runSearch(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      queryText: "climber reliability",
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.document.id).toBe(DOC_ID);
    expect(result.summary).toContain("Switch to telescoping climber");

    const queryInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO decision_search_queries"));
    expect(queryInsert).toBeDefined();
    expect(queryInsert?.params).toContain("climber reliability");

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
