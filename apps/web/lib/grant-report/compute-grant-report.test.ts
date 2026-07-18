import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeGrantReportView, generateGrantReport } from "./compute-grant-report";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeGrantReportView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeGrantReportView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with eligible awarded grants and generated reports", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM grant_applications ga") && sql.includes("LEFT JOIN grant_opportunities")) {
        return {
          rows: [
            {
              id: GRANT_ID,
              name: "NASA Grant",
              funder: "NASA",
              seasonYear: 2026,
              amountAwardedUsd: "2000.00",
              decisionAt: "2026-01-15T00:00:00.000Z",
              hasReport: false,
            },
          ],
        };
      }
      if (sql.includes("SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM grant_report_reports r")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await computeGrantReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eligibleGrants).toHaveLength(1);
    expect(view.eligibleGrants[0]?.name).toBe("NASA Grant");
    expect(view.eligibleGrants[0]?.amountAwardedUsd).toBe(2000);
    expect(view.reports).toHaveLength(0);
  });
});

describe("generateGrantReport", () => {
  it("summarizes outreach and finance rows into a deterministic report and persists it", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM grant_applications ga") && sql.includes("WHERE ga.id = $1")) {
        return {
          rows: [
            { name: "NASA Grant", funder: "NASA", seasonYear: 2026, amountAwardedUsd: "2000.00", status: "awarded" },
          ],
        };
      }
      if (sql.includes("FROM outreach_messages")) {
        return { rows: [{ kind: "grant_followup" }, { kind: "thank_you" }, { kind: "grant_followup" }] };
      }
      if (sql.includes("FROM finance_transactions")) {
        return {
          rows: [
            { category: "Robot parts", amountUsd: "500.00" },
            { category: "Robot parts", amountUsd: "300.00" },
            { category: "Travel", amountUsd: "200.00" },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO grant_report_reports")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "report-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const report = await generateGrantReport(client, { orgId: ORG, userId: USER, grantApplicationId: GRANT_ID });

    expect(report.grantName).toBe("NASA Grant");
    expect(report.amountAwardedUsd).toBe(2000);
    expect(report.totalSpendUsd).toBe(1000);
    expect(report.outreachCount).toBe(3);
    expect(report.spendByCategory[0]?.category).toBe("Robot parts");
    expect(report.spendByCategory[0]?.totalUsd).toBe(800);
    expect(report.narrative).toContain("NASA Grant");
    expect(report.narrative).toContain("$2,000");

    const reportInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO grant_report_reports"));
    expect(reportInsert).toBeDefined();

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });

  it("throws when the grant is not awarded", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM grant_applications ga") && sql.includes("WHERE ga.id = $1")) {
        return {
          rows: [
            { name: "NASA Grant", funder: "NASA", seasonYear: 2026, amountAwardedUsd: null, status: "submitted" },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      generateGrantReport(client, { orgId: ORG, userId: USER, grantApplicationId: GRANT_ID }),
    ).rejects.toThrow("awarded");
  });
});
