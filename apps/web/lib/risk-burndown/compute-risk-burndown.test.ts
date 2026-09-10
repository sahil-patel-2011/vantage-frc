import { describe, expect, it } from "vitest";
import { computeRiskBurndownView } from "./compute-risk-burndown";
import { computeRiskBurndownSeries, riskCategoryLabel, riskStatusLabel, severityBandOf, severityOf, summarizeRisks } from ".";
import type { RiskItem } from "./types";
import { expectPlainCopy } from "../ui/copy-assertions";

type QueryCall = { sql: string; params: unknown[] };

function makeMockClient(rowsBySql: (sql: string) => unknown[]) {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rowsBySql(sql), rowCount: rowsBySql(sql).length };
    },
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

let seq = 0;
function risk(overrides: Partial<RiskItem> = {}): RiskItem {
  seq += 1;
  const likelihood = overrides.likelihood ?? 3;
  const impact = overrides.impact ?? 3;
  const severity = severityOf(likelihood, impact);
  return {
    id: `risk-${seq}`,
    title: `Risk ${seq}`,
    description: null,
    category: "technical",
    status: "open",
    likelihood,
    impact,
    severity,
    severityBand: severityBandOf(severity),
    ownerName: null,
    mitigationPlan: null,
    identifiedOn: "2026-01-01",
    targetCloseDate: null,
    closedOn: null,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeRiskBurndownView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient(() => []);
    const view = await computeRiskBurndownView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.map((s) => s.id)).toEqual(["workspace", "risks", "fmea"]);
      expect(view.steps.find((s) => s.id === "risks")?.href).toBe("/risks");
      expect(view.steps.find((s) => s.id === "fmea")?.href).toBe("/team?tab=fmea");
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      view.steps.forEach((s) => expectPlainCopy(s.detail));
    }
  });

  it("returns a live view with risks, summary, and series for a real org", async () => {
    const { client } = makeMockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return [{ orgId: "org-1", teamNumber: 254 }];
      }
      if (sql.includes("FROM risk_burndown_items") && sql.includes("SELECT id, title")) {
        return [
          {
            id: "r1",
            title: "Drivetrain motor lead time",
            description: null,
            category: "logistics",
            status: "open",
            likelihood: 4,
            impact: 5,
            ownerName: "Alex",
            mitigationPlan: "Order spares early",
            identifiedOn: "2026-01-05",
            targetCloseDate: "2026-02-01",
            closedOn: null,
            seasonYear: 2026,
            createdAt: "2026-01-05T00:00:00.000Z",
          },
          {
            id: "r2",
            title: "Programmer availability",
            description: null,
            category: "personnel",
            status: "closed",
            likelihood: 2,
            impact: 3,
            ownerName: "Sam",
            mitigationPlan: "Cross-trained backup",
            identifiedOn: "2026-01-10",
            targetCloseDate: "2026-01-20",
            closedOn: "2026-01-18",
            seasonYear: 2026,
            createdAt: "2026-01-10T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("DISTINCT season_year")) {
        return [{ seasonYear: 2026 }];
      }
      return [];
    });

    const view = await computeRiskBurndownView(client, {
      userId: "u1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.teamNumber).toBe(254);
      expect(view.risks).toHaveLength(2);
      expect(view.summary.totalRisks).toBe(2);
      expect(view.summary.openRisks).toBe(1);
      expect(view.summary.closedRisks).toBe(1);
      expect(view.series.length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeRisks", () => {
  it("returns an all-zero summary for no risks", () => {
    const s = summarizeRisks([]);
    expect(s.totalRisks).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.burndownSignal).toBe(0);
  });

  it("counts by status and severity band", () => {
    const risks = [
      risk({ status: "open", likelihood: 5, impact: 5 }), // severity 25 -> critical
      risk({ status: "mitigating", likelihood: 2, impact: 2 }), // severity 4 -> low
      risk({ status: "closed", likelihood: 3, impact: 3 }), // severity 9 -> medium
    ];
    const s = summarizeRisks(risks);
    expect(s.totalRisks).toBe(3);
    expect(s.openRisks).toBe(1);
    expect(s.mitigatingRisks).toBe(1);
    expect(s.closedRisks).toBe(1);
    expect(s.highSeverityOpenCount).toBe(1);
    expect(s.bySeverityBand.find((b) => b.band === "critical")?.count).toBe(1);
  });
});

describe("severityOf / severityBandOf", () => {
  it("computes severity as likelihood * impact and clamps to 1..5", () => {
    expect(severityOf(3, 4)).toBe(12);
    expect(severityOf(0, 10)).toBe(5); // clamped to 1 and 5
  });

  it("bands severity into low/medium/high/critical", () => {
    expect(severityBandOf(2)).toBe("low");
    expect(severityBandOf(8)).toBe("medium");
    expect(severityBandOf(14)).toBe("high");
    expect(severityBandOf(25)).toBe("critical");
  });
});

describe("computeRiskBurndownSeries", () => {
  it("returns an empty series when there are no risks", () => {
    expect(computeRiskBurndownSeries([])).toEqual([]);
  });

  it("shows open count dropping to zero once every risk is closed before today", () => {
    const risks = [
      risk({ identifiedOn: "2026-01-01", status: "closed", closedOn: "2026-01-02" }),
      risk({ identifiedOn: "2026-01-01", status: "closed", closedOn: "2026-01-03" }),
    ];
    const series = computeRiskBurndownSeries(risks, new Date("2026-01-05T00:00:00.000Z"));
    expect(series[0]?.date).toBe("2026-01-01");
    expect(series[0]?.openCount).toBe(2);
    const last = series[series.length - 1];
    expect(last?.date).toBe("2026-01-05");
    expect(last?.openCount).toBe(0);
  });
});

describe("labels", () => {
  it("labels categories and statuses", () => {
    expect(riskCategoryLabel("technical")).toBe("Technical");
    expect(riskStatusLabel("mitigating")).toBe("Mitigating");
  });
});
