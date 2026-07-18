import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSeasonReportView, generateSnapshot } from "./compute-season-report";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSeasonReportView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with per-category summary from logged entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM season_report_entries") && sql.includes("ORDER BY created_at DESC") && !sql.includes("DISTINCT")) {
        return {
          rows: [
            {
              id: "entry-1",
              seasonYear: 2026,
              category: "build_reliability",
              title: "Drivetrain held up all season",
              detail: null,
              metricLabel: "Match failures",
              metricValue: "0",
              sentiment: "positive",
              createdAt: "2026-04-01T00:00:00.000Z",
            },
            {
              id: "entry-2",
              seasonYear: 2026,
              category: "budget",
              title: "Overspent on drivetrain motors",
              detail: null,
              metricLabel: null,
              metricValue: null,
              sentiment: "negative",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM season_report_snapshots")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.completeness).toBeCloseTo(2 / 5, 5);
    const build = view.summary.byCategory.find((row) => row.category === "build_reliability");
    expect(build?.positive).toBe(1);
    const budget = view.summary.byCategory.find((row) => row.category === "budget");
    expect(budget?.negative).toBe(1);
  });
});

describe("generateSnapshot", () => {
  it("synthesizes and persists a deterministic narrative snapshot from logged entries", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM season_report_entries") && !sql.includes("DISTINCT")) {
        return {
          rows: [
            {
              id: "entry-1",
              seasonYear: 2026,
              category: "outreach",
              title: "STEM night at elementary school",
              detail: null,
              metricLabel: "People reached",
              metricValue: "120",
              sentiment: "positive",
              createdAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO season_report_snapshots")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "snapshot-1", createdAt: "2026-04-02T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const snapshot = await generateSnapshot(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(snapshot.entryCount).toBe(1);
    expect(snapshot.completeness).toBeCloseTo(1 / 5, 5);
    expect(snapshot.highlights.length).toBeGreaterThan(0);
    expect(snapshot.narrative.outreach).toContain("outreach");
    expect(snapshot.narrative.budget).toContain("No budget");

    const snapshotInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO season_report_snapshots"));
    expect(snapshotInsert).toBeDefined();

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
