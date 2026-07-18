import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeLeadershipReadiness, leadershipCategoryLabel, summarizeLeadership } from ".";
import { computeLeadershipView } from "./compute-leadership";
import type { LeadershipRole } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

function role(overrides: Partial<LeadershipRole> = {}): LeadershipRole {
  return {
    id: "role-1",
    roleTitle: "Team Captain",
    category: "leadership",
    holderName: "Ada",
    holderUserId: null,
    successorName: null,
    successorUserId: null,
    handoffStatus: "not_started",
    targetHandoffDate: null,
    notes: null,
    seasonYear: 2026,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeLeadership / computeLeadershipReadiness (pure)", () => {
  it("returns a zeroed summary and at-risk readiness for no roles", () => {
    const summary = summarizeLeadership([]);
    expect(summary.totalRoles).toBe(0);
    expect(summary.withSuccessor).toBe(0);
    expect(summary.continuityScore).toBe(0);
    expect(summary.byStatus).toHaveLength(0);

    const readiness = computeLeadershipReadiness(summary, []);
    expect(readiness.score).toBe(0);
    expect(readiness.tier).toBe("at_risk");
    expect(readiness.recommendations.length).toBeGreaterThan(0);
  });

  it("scores higher continuity when successors are identified and trained", () => {
    const roles: LeadershipRole[] = [
      role({ id: "1", roleTitle: "Team Captain", successorName: "Bo", handoffStatus: "in_training" }),
      role({ id: "2", roleTitle: "Drivetrain Lead", category: "technical", successorName: "Cy", handoffStatus: "ready" }),
      role({ id: "3", roleTitle: "Business Lead", category: "business", successorName: null, handoffStatus: "not_started" }),
    ];
    const summary = summarizeLeadership(roles);
    expect(summary.totalRoles).toBe(3);
    expect(summary.withSuccessor).toBe(2);
    expect(summary.withoutSuccessor).toBe(1);
    expect(summary.continuityScore).toBeGreaterThan(0);

    const readiness = computeLeadershipReadiness(summary, roles);
    expect(readiness.rolesAtRisk).toContain("Business Lead");
    expect(readiness.recommendations.some((r) => r.includes("Business Lead"))).toBe(true);
  });

  it("labels categories for display", () => {
    expect(leadershipCategoryLabel("technical")).toMatch(/technical/i);
    expect(leadershipCategoryLabel("mentor")).toBe("Mentor");
  });
});

describe("computeLeadershipView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeLeadershipView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live summary view built from logged leadership roles", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM leadership_roles") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "role-1",
              roleTitle: "Team Captain",
              category: "leadership",
              holderName: "Ada",
              holderUserId: null,
              successorName: "Bo",
              successorUserId: null,
              handoffStatus: "identified",
              targetHandoffDate: null,
              notes: null,
              seasonYear: 2026,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeLeadershipView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.roles).toHaveLength(1);
      expect(view.roles[0].successorName).toBe("Bo");
      expect(view.summary.totalRoles).toBe(1);
      expect(view.summary.withSuccessor).toBe(1);
      expect(view.readiness.coverage).toBeCloseTo(1);
    }
  });
});
