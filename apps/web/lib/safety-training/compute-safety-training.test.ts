import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeSafetyTrainingView } from "./compute-safety-training";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const MODULE_REQUIRED = "33333333-3333-4333-8333-333333333333";
const MODULE_OPTIONAL = "44444444-4444-4444-8444-444444444444";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeSafetyTrainingView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSafetyTrainingView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with per-member coverage and compliance summary", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM safety_training_modules")) {
        return {
          rows: [
            {
              id: MODULE_REQUIRED,
              title: "Table Saw Certification",
              category: "power_tools",
              description: "Required before using the table saw unsupervised.",
              isRequired: true,
              validityMonths: 12,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: MODULE_OPTIONAL,
              title: "Chemical Handling",
              category: "chemical",
              description: null,
              isRequired: false,
              validityMonths: null,
              createdAt: "2026-01-05T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM safety_training_completions")) {
        return {
          rows: [
            {
              id: "comp-1",
              moduleId: MODULE_REQUIRED,
              moduleTitle: "Table Saw Certification",
              category: "power_tools",
              isRequired: true,
              memberId: USER,
              memberName: "Jamie Lead",
              completedOn: "2026-01-10",
              expiresOn: "2099-01-10",
              certificateUrl: null,
              notes: null,
            },
          ],
        };
      }
      if (sql.includes("FROM memberships mem")) {
        return {
          rows: [
            { id: USER, name: "Jamie Lead" },
            { id: OTHER_USER, name: "Alex Mentor" },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeSafetyTrainingView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.modules).toHaveLength(2);
    expect(view.completions).toHaveLength(1);
    expect(view.summary.requiredModules).toBe(1);
    expect(view.summary.memberCount).toBe(2);
    // Jamie has completed the required module; Alex has not.
    const jamie = view.coverage.find((c) => c.memberId === USER);
    const alex = view.coverage.find((c) => c.memberId === OTHER_USER);
    expect(jamie?.compliant).toBe(true);
    expect(alex?.compliant).toBe(false);
    expect(view.summary.compliantMemberCount).toBe(1);
    expect(view.summary.complianceRate).toBeCloseTo(0.5);
  });
});
