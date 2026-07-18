import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeCodeDeployLogView } from "./compute-code-deploy-log";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCodeDeployLogView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCodeDeployLogView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from logged deploy entries, summarized", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM code_deploy_log_entries") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "deploy-1",
              seasonYear: 2026,
              deployedOn: "2026-02-10",
              matchKey: "2026miket_qm10",
              eventKey: "2026miket",
              firmwareVersion: "v1.4.0",
              commitSha: "abc1234",
              branch: "main",
              deployType: "qualification",
              status: "deployed",
              notes: "Clean deploy before qm10",
              createdAt: "2026-02-10T00:00:00.000Z",
            },
            {
              id: "deploy-2",
              seasonYear: 2026,
              deployedOn: "2026-02-09",
              matchKey: null,
              eventKey: null,
              firmwareVersion: "v1.3.9",
              commitSha: "def5678",
              branch: "main",
              deployType: "pit_test",
              status: "rolled_back",
              notes: null,
              createdAt: "2026-02-09T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeCodeDeployLogView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(2);
    expect(view.entries[0]?.firmwareVersion).toBe("v1.4.0");
    expect(view.summary.totalDeploys).toBe(2);
    expect(view.summary.matchLinkedDeploys).toBe(1);
    expect(view.summary.lastDeployedOn).toBe("2026-02-10");
    expect(view.summary.rollbackRate).toBeCloseTo(0.5);
  });
});
