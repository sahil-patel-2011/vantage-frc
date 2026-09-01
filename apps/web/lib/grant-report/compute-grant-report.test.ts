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

  it("does not replay stored season spend when linkage schema is missing", async () => {
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
              hasReport: true,
            },
          ],
        };
      }
      if (sql.includes("SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM grant_report_reports r")) {
        return {
          rows: [
            {
              id: "report-1",
              grantApplicationId: GRANT_ID,
              grantName: "NASA Grant",
              funder: "NASA",
              seasonYear: 2026,
              amountAwardedUsd: "2000.00",
              totalSpendUsd: "5000.00",
              outreachCount: 1,
              outreachByKind: [{ kind: "thank_you", count: 1 }],
              spendByCategory: [{ category: "Season operations", totalUsd: 5000, count: 12 }],
              sections: [],
              narrative: "Recorded fund usage: $5,000 season total",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("to_regclass")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeGrantReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.reports).toHaveLength(1);
    expect(view.reports[0]?.totalSpendUsd).toBe(0);
    expect(view.reports[0]?.spendAttribution).toBe("setup_required");
    expect(view.reports[0]?.spendByCategory).toEqual([]);
    expect(view.reports[0]?.narrative).not.toContain("5,000");
    expect(view.reports[0]?.narrative).toContain("Spend linkage is not configured");
  });

  it("overlays only grant-linked allocations and ignores stored season totals", async () => {
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
              hasReport: true,
            },
          ],
        };
      }
      if (sql.includes("SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM grant_report_reports r")) {
        return {
          rows: [
            {
              id: "report-1",
              grantApplicationId: GRANT_ID,
              grantName: "NASA Grant",
              funder: "NASA",
              seasonYear: 2026,
              amountAwardedUsd: "2000.00",
              totalSpendUsd: "5000.00",
              outreachCount: 0,
              outreachByKind: [],
              spendByCategory: [{ category: "Season operations", totalUsd: 5000, count: 12 }],
              sections: [],
              narrative: "old season total",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("to_regclass")) {
        return { rows: [{ ok: "grant_finance_allocations" }] };
      }
      if (sql.includes("FROM grant_finance_allocations")) {
        return {
          rows: [{ grantApplicationId: GRANT_ID, amountUsd: "150.00", category: "Robot parts" }],
        };
      }
      return { rows: [] };
    });

    const view = await computeGrantReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.reports[0]?.spendAttribution).toBe("explicit");
    expect(view.reports[0]?.totalSpendUsd).toBe(150);
    expect(view.reports[0]?.spendByCategory).toEqual([{ category: "Robot parts", totalUsd: 150, count: 1 }]);
    expect(view.reports[0]?.narrative).toContain("Grant-attributed spend");
    expect(view.reports[0]?.narrative).not.toContain("5,000");
    expect(view.reports[0]?.narrative).not.toContain("Season operations");
  });
});

describe("generateGrantReport", () => {
  it("summarizes outreach without attributing unlinked season spend", async () => {
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
    expect(report.totalSpendUsd).toBe(0);
    expect(report.spendAttribution).toBe("setup_required");
    expect(report.outreachCount).toBe(3);
    expect(report.spendByCategory).toEqual([]);
    expect(report.narrative).toContain("NASA Grant");
    expect(report.narrative).toContain("$2,000");
    // Season expenses have no per-grant linkage: the report must disclose that instead of
    // presenting org-wide spend as if it were this grant's spend.
    expect(report.narrative).toContain("Spend linkage is not configured");
    expect(report.narrative).toContain("No season-wide expense is included");
    const spendSection = report.sections.find((section) => section.id === "spend");
    expect(spendSection?.title).toBe("Grant-attributed spend unavailable");
    expect(spendSection?.body).not.toContain("total season expenses");

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

  it("attributes only tagged allocations when the linkage table exists", async () => {
    const queried: string[] = [];
    const client = makeClient((sql) => {
      queried.push(sql);
      if (sql.includes("FROM grant_applications ga") && sql.includes("WHERE ga.id = $1")) {
        return {
          rows: [
            { name: "NASA Grant", funder: "NASA", seasonYear: 2026, amountAwardedUsd: "2000.00", status: "awarded" },
          ],
        };
      }
      if (sql.includes("FROM outreach_messages")) {
        return { rows: [{ kind: "thank_you" }] };
      }
      if (sql.includes("to_regclass")) {
        return { rows: [{ ok: "grant_finance_allocations" }] };
      }
      if (sql.includes("FROM grant_finance_allocations")) {
        return {
          rows: [
            { grantApplicationId: GRANT_ID, amountUsd: "150.00", category: "Robot parts" },
            { grantApplicationId: GRANT_ID, amountUsd: "75.55", category: "Travel" },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) return { rows: [] };
      if (sql.includes("INSERT INTO grant_report_reports")) {
        return { rows: [{ id: "report-2", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const report = await generateGrantReport(client, { orgId: ORG, userId: USER, grantApplicationId: GRANT_ID });

    expect(report.spendAttribution).toBe("explicit");
    expect(report.totalSpendUsd).toBe(225.55);
    expect(report.spendByCategory).toEqual([
      { category: "Robot parts", totalUsd: 150, count: 1 },
      { category: "Travel", totalUsd: 75.55, count: 1 },
    ]);
    expect(report.narrative).toContain("Grant-attributed spend");
    expect(report.narrative).not.toContain("Spend linkage is not configured");
    expect(queried.some((sql) => sql.includes("FROM finance_transactions") && !sql.includes("grant_finance_allocations"))).toBe(
      false,
    );
  });
});
