import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { busFactorAreaLabel, summarizeBusFactor } from ".";
import { computeBusFactorView } from "./compute-bus-factor";
import type { WorkloadEntry } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("summarizeBusFactor (pure)", () => {
  it("returns a zeroed, low-risk summary for no entries", () => {
    const summary = summarizeBusFactor([]);
    expect(summary.activeMembers).toBe(0);
    expect(summary.riskScore).toBe(0);
    expect(summary.riskLevel).toBe("low");
    expect(summary.flags).toHaveLength(0);
    expect(summary.areaConcentration).toHaveLength(0);
  });

  it("flags a single-contributor area as a concentration risk", () => {
    const entries: WorkloadEntry[] = [
      {
        id: "1",
        memberUserId: "member-a",
        memberName: "Ada",
        area: "software",
        weekStart: "2026-07-06",
        hoursLogged: 10,
        tasksOwned: 4,
        soleKnowledgeCount: 1,
      },
      {
        id: "2",
        memberUserId: "member-a",
        memberName: "Ada",
        area: "software",
        weekStart: "2026-06-29",
        hoursLogged: 8,
        tasksOwned: 3,
        soleKnowledgeCount: 0,
      },
    ];
    const summary = summarizeBusFactor(entries);
    const softwareArea = summary.areaConcentration.find((a) => a.area === "software");
    expect(softwareArea?.contributors).toBe(1);
    expect(softwareArea?.concentrationScore).toBeGreaterThan(0.9);
    expect(summary.flags.some((f) => f.kind === "concentration" && f.level === "high")).toBe(true);
    expect(summary.flags.some((f) => f.kind === "sole_knowledge")).toBe(true);
    expect(summary.riskScore).toBeGreaterThan(0);
  });

  it("flags an overloaded member relative to the team mean", () => {
    const entries: WorkloadEntry[] = [
      { id: "1", memberUserId: "a", memberName: "Ada", area: "mechanical", weekStart: "2026-07-06", hoursLogged: 30, tasksOwned: 2, soleKnowledgeCount: 0 },
      { id: "2", memberUserId: "b", memberName: "Bo", area: "mechanical", weekStart: "2026-07-06", hoursLogged: 5, tasksOwned: 1, soleKnowledgeCount: 0 },
      { id: "3", memberUserId: "c", memberName: "Cy", area: "electrical", weekStart: "2026-07-06", hoursLogged: 5, tasksOwned: 1, soleKnowledgeCount: 0 },
    ];
    const summary = summarizeBusFactor(entries);
    expect(summary.flags.some((f) => f.kind === "overload" && f.memberName === "Ada")).toBe(true);
    const ada = summary.memberWorkloads.find((m) => m.memberUserId === "a");
    expect(ada?.overloadRatio).toBeGreaterThan(1.6);
  });

  it("labels areas for display", () => {
    expect(busFactorAreaLabel("mechanical")).toBe("Mechanical");
    expect(busFactorAreaLabel("admin")).toMatch(/logistics/i);
  });
});

describe("computeBusFactorView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeBusFactorView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live summary view built from logged workload entries", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM bus_factor_workload_entries")) {
        return {
          rows: [
            {
              id: "entry-1",
              memberUserId: "member-a",
              memberName: "Ada",
              area: "software",
              weekStart: "2026-07-06",
              hoursLogged: "12.5",
              tasksOwned: 3,
              soleKnowledgeCount: 1,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM memberships m JOIN users")) {
        return { rows: [{ userId: "member-a", name: "Ada" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeBusFactorView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0].hoursLogged).toBeCloseTo(12.5);
      expect(view.summary.activeMembers).toBe(1);
      expect(view.members).toHaveLength(1);
    }
  });
});
