import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSponsorSuiteView, generateRoiReport } from "./compute-sponsor-suite";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSponsorSuiteView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSponsorSuiteView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with sponsors, goal progress, decks, ROI reports, and reminders", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM sponsors WHERE org_id")) {
        return { rows: [{ id: "sponsor-1", name: "Acme Robotics", tier: "gold", status: "active" }] };
      }
      if (sql.includes("UNION SELECT DISTINCT season_year FROM sponsor_suite_goals")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM sponsor_suite_decks")) {
        return { rows: [] };
      }
      if (sql.includes("FROM sponsor_suite_roi_reports")) {
        return { rows: [] };
      }
      if (sql.includes("FROM sponsor_suite_reminders")) {
        return { rows: [] };
      }
      if (sql.includes("FROM sponsor_suite_goals WHERE org_id")) {
        return { rows: [{ goalUsd: "5000.00" }] };
      }
      if (sql.includes("SUM(amount_usd)")) {
        return { rows: [{ actualUsd: "1500.00" }] };
      }
      return { rows: [] };
    });

    const view = await computeSponsorSuiteView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.sponsors).toHaveLength(1);
    expect(view.sponsors[0]?.name).toBe("Acme Robotics");
    expect(view.goal.goalUsd).toBe(5000);
    expect(view.goal.actualUsd).toBe(1500);
    expect(view.goal.attainmentPct).toBeCloseTo(0.3);
    expect(view.decks).toHaveLength(0);
    expect(view.roiReports).toHaveLength(0);
    expect(view.reminders).toHaveLength(0);
  });
});

describe("generateRoiReport", () => {
  it("summarizes sponsor contributions into a deterministic ROI report and persists it", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM sponsor_contributions") && sql.includes("JOIN sponsors")) {
        return {
          rows: [
            { sponsorId: "sponsor-1", sponsorName: "Acme Robotics", tier: "gold", amountUsd: "1000.00" },
            { sponsorId: "sponsor-1", sponsorName: "Acme Robotics", tier: "gold", amountUsd: "500.00" },
            { sponsorId: "sponsor-2", sponsorName: "Bolt Supply", tier: "silver", amountUsd: "300.00" },
          ],
        };
      }
      if (sql.includes("FROM sponsor_suite_goals WHERE org_id")) {
        return { rows: [{ goalUsd: "5000.00" }] };
      }
      if (sql.includes("SUM(amount_usd)") && sql.includes("sponsor_contributions WHERE org_id")) {
        return { rows: [{ actualUsd: "1800.00" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO sponsor_suite_roi_reports")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "report-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const report = await generateRoiReport(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(report.totalRaisedUsd).toBe(1800);
    expect(report.totalSponsors).toBe(2);
    expect(report.lines[0]?.sponsorName).toBe("Acme Robotics");
    expect(report.lines[0]?.totalContributedUsd).toBe(1500);
    expect(report.narrative).toContain("2026 season");

    const reportInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO sponsor_suite_roi_reports"));
    expect(reportInsert).toBeDefined();

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
