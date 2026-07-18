import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { buildCounterPlan, computeFailureTriggers, computeTendencies, counterBookFieldLabel } from ".";
import { computeCounterBookView, generateCounterBookReport } from "./compute-counter-book";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("counter-book pure helpers", () => {
  it("computes tendencies only for fields with at least the minimum sample size", () => {
    const payloads = [
      { autoPoints: 10, teleopPoints: 20 },
      { autoPoints: 12, teleopPoints: 40 },
      { autoPoints: 8 },
    ];
    const tendencies = computeTendencies(payloads);
    const fields = tendencies.map((t) => t.field);
    expect(fields).toContain("autoPoints");
    expect(fields).toContain("teleopPoints");
    const auto = tendencies.find((t) => t.field === "autoPoints")!;
    expect(auto.sampleSize).toBe(3);
    expect(auto.average).toBeCloseTo(10, 5);
  });

  it("flags high-variance fields as failure triggers", () => {
    const payloads = [{ climb: 0 }, { climb: 20 }, { climb: 0 }, { climb: 18 }];
    const tendencies = computeTendencies(payloads);
    const triggers = computeFailureTriggers(tendencies);
    expect(triggers.some((t) => t.field === "climb")).toBe(true);
  });

  it("builds a no-data counter plan when there are no tendencies", () => {
    const plan = buildCounterPlan("Team 254", [], []);
    expect(plan).toMatch(/No scouted numeric tendencies/);
  });

  it("humanizes field labels", () => {
    expect(counterBookFieldLabel("autoPoints")).toBe("Auto Points");
    expect(counterBookFieldLabel("endgame_status")).toBe("Endgame Status");
  });
});

describe("computeCounterBookView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeCounterBookView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view listing generated reports for the org", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 100 }], rowCount: 1 };
      }
      if (sql.includes("FROM counter_book_reports")) {
        return {
          rows: [
            {
              id: "report-1",
              teamKey: "frc254",
              teamNumber: 254,
              eventKey: "2026casj",
              title: "Counter-book — Team 254",
              matchesScouted: 5,
              tendencies: [{ field: "autoPoints", average: 12, sampleSize: 5, variability: 0.1 }],
              failureTriggers: [],
              counterPlan: "Team 254 leans hardest on Auto Points.",
              summary: "5 scouted match(es) for Team 254 · strongest tendency: Auto Points.",
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeCounterBookView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.reports).toHaveLength(1);
      expect(view.reports[0].teamKey).toBe("frc254");
      expect(view.reports[0].tendencies[0].field).toBe("autoPoints");
    }
  });
});

describe("generateCounterBookReport", () => {
  it("throws instead of fabricating a report when there is no scouting data for the opponent", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM teams_ref")) return { rows: [{ teamNumber: 254 }], rowCount: 1 };
      if (sql.includes("FROM match_scout_entries")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    await expect(
      generateCounterBookReport(client, { orgId: ORG, userId: USER, teamKey: "frc254", eventKey: null }),
    ).rejects.toThrow(/No scouted matches/);
  });

  it("generates a grounded report from scouted payloads and meters the AI usage event", async () => {
    const queries: string[] = [];
    const client = mockClient((sql) => {
      queries.push(sql);
      if (sql.includes("FROM teams_ref")) return { rows: [{ teamNumber: 254 }], rowCount: 1 };
      if (sql.includes("FROM match_scout_entries")) {
        return {
          rows: [
            { payload: { autoPoints: 10, teleopPoints: 30 } },
            { payload: { autoPoints: 14, teleopPoints: 32 } },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [
            {
              tier: "team",
              credit_cap_usd: "100",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("COALESCE")) return { rows: [{ used: "0", grants: "0" }], rowCount: 1 };
      if (sql.includes("INSERT INTO counter_book_reports")) {
        return { rows: [{ id: "report-1", createdAt: new Date().toISOString() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const report = await generateCounterBookReport(client, {
      orgId: ORG,
      userId: USER,
      teamKey: "frc254",
      eventKey: null,
    });

    expect(report.matchesScouted).toBe(2);
    expect(report.teamNumber).toBe(254);
    expect(report.tendencies.some((t) => t.field === "autoPoints")).toBe(true);
    expect(report.counterPlan).toMatch(/Team 254/);
    expect(queries.some((q) => q.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });
});
