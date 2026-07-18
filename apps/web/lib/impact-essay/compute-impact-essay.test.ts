import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeImpactEssayView, generateEssayDraft } from "./compute-impact-essay";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SEASON = 2026;

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeImpactEssayView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeImpactEssayView(client, { userId: USER, requestedOrg: null, seasonYear: SEASON });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.seasonYear).toBe(SEASON);
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.some((s) => s.href.includes("/business?tab=impact"))).toBe(true);
      expect(view.steps.some((s) => s.href.includes("/business?tab=evidence"))).toBe(true);
      expect(view.steps.some((s) => s.href.includes("/ai?tab=writer"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      expect(view.steps.every((s) => /never DEMO|org-scoped|real|blank/i.test(s.detail))).toBe(true);
    }
  });

  it("returns a live view grounded in outreach activities, hours, sponsors, and events", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM impact_activities") && sql.includes("SELECT id, title, category")) {
        return {
          rows: [
            {
              id: "act1",
              title: "Elementary STEM night",
              category: "stem_demo",
              occurredOn: "2026-03-01",
              peopleReached: 120,
              durationMinutes: 180,
            },
          ],
        };
      }
      if (sql.includes("FROM hour_logs")) {
        return { rows: [{ totalHours: "42.5", contributorCount: "6" }] };
      }
      if (sql.includes("FROM sponsors")) {
        return { rows: [{ id: "sp1", name: "Acme Robotics", tier: "gold", status: "active" }] };
      }
      if (sql.includes("FROM attendance_events")) {
        return { rows: [{ id: "ev1", title: "Regional kickoff", kind: "competition", occurredOn: "2026-01-10", creditHours: "3" }] };
      }
      if (sql.includes("FROM impact_essay_drafts") && sql.includes("SELECT id, season_year")) {
        return { rows: [] };
      }
      if (sql.includes("UNION")) return { rows: [{ seasonYear: SEASON }] };
      return { rows: [] };
    });

    const view = await computeImpactEssayView(client, { userId: USER, requestedOrg: ORG, seasonYear: SEASON });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.facts.hasGroundedData).toBe(true);
    expect(view.facts.outreachActivities).toHaveLength(1);
    expect(view.facts.totalPeopleReached).toBe(120);
    expect(view.facts.buildHours.totalHours).toBe(42.5);
    expect(view.facts.sponsors).toHaveLength(1);
    expect(view.facts.events).toHaveLength(1);
    expect(view.drafts).toHaveLength(0);
  });
});

describe("generateEssayDraft", () => {
  it("composes a grounded essay, meters it, and persists a draft with citations", async () => {
    const inserts: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM impact_activities") && sql.includes("SELECT id, title, category")) {
        return {
          rows: [
            {
              id: "act1",
              title: "Elementary STEM night",
              category: "stem_demo",
              occurredOn: "2026-03-01",
              peopleReached: 120,
              durationMinutes: 180,
            },
          ],
        };
      }
      if (sql.includes("FROM hour_logs")) return { rows: [{ totalHours: "10", contributorCount: "3" }] };
      if (sql.includes("FROM sponsors")) return { rows: [] };
      if (sql.includes("FROM attendance_events")) return { rows: [] };
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO impact_essay_drafts")) {
        inserts.push({ sql, params });
        return { rows: [{ id: "draft1", createdAt: "2026-03-02T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const draft = await generateEssayDraft(client, {
      orgId: ORG,
      userId: USER,
      award: "impact",
      seasonYear: SEASON,
    });

    expect(draft.id).toBe("draft1");
    expect(draft.essayText).toContain("Elementary STEM night");
    expect(draft.citations.length).toBeGreaterThan(0);
    expect(draft.citations[0]).toMatchObject({ kind: "outreach_activity", id: "act1" });
    expect(draft.wordCount).toBeGreaterThan(0);

    const usageInsert = inserts.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
    const draftInsert = inserts.find((entry) => entry.sql.includes("INSERT INTO impact_essay_drafts"));
    expect(draftInsert).toBeDefined();
    expect(draftInsert?.params).toContain(ORG);
  });
});
