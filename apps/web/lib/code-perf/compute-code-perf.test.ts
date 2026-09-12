import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { analyzeChange, computeCodePerfView } from "./compute-code-perf";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCodePerfView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCodePerfView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from logged changes and match results, summarized", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM code_perf_changes") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "change-1",
              seasonYear: 2026,
              occurredOn: "2026-02-10",
              changeType: "commit",
              subsystem: "shooter",
              title: "Retune shooter gains",
              commitSha: "abc1234",
              repoUrl: "https://github.com/team/robot-code",
              description: "Tightened kP after auton overshoot",
              verdict: "improved",
              deltaAuto: "0.50",
              deltaTeleop: "2.00",
              deltaTotal: "2.50",
              matchesBefore: 3,
              matchesAfter: 3,
              rationale: "Avg auto+teleop went up by 2.5 pt.",
              analyzedAt: "2026-02-11T00:00:00.000Z",
              createdAt: "2026-02-10T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM code_perf_match_results") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "match-1",
              seasonYear: 2026,
              occurredOn: "2026-02-09",
              matchKey: "2026miket_qm10",
              eventKey: "2026miket",
              autoPoints: "6.00",
              teleopPoints: "18.00",
              endgamePoints: "5.00",
              notes: null,
              createdAt: "2026-02-09T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("UNION")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeCodePerfView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.changes).toHaveLength(1);
    expect(view.changes[0]?.verdict).toBe("improved");
    expect(view.matches).toHaveLength(1);
    expect(view.matches[0]?.totalPoints).toBe(29);
    expect(view.summary.improved).toBe(1);
    expect(view.summary.totalChanges).toBe(1);
  });
});

describe("analyzeChange", () => {
  it("computes and persists a deterministic before/after correlation, and meters the run", async () => {
    const updates: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("SELECT occurred_on")) {
        return { rows: [{ occurredOn: "2026-02-10", seasonYear: 2026 }] };
      }
      if (sql.includes("FROM code_perf_match_results") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "m1",
              seasonYear: 2026,
              occurredOn: "2026-02-05",
              matchKey: "qm1",
              eventKey: null,
              autoPoints: "3.00",
              teleopPoints: "10.00",
              endgamePoints: "0.00",
              notes: null,
              createdAt: "2026-02-05T00:00:00.000Z",
            },
            {
              id: "m2",
              seasonYear: 2026,
              occurredOn: "2026-02-06",
              matchKey: "qm2",
              eventKey: null,
              autoPoints: "4.00",
              teleopPoints: "11.00",
              endgamePoints: "0.00",
              notes: null,
              createdAt: "2026-02-06T00:00:00.000Z",
            },
            {
              id: "m3",
              seasonYear: 2026,
              occurredOn: "2026-02-11",
              matchKey: "qm3",
              eventKey: null,
              autoPoints: "6.00",
              teleopPoints: "16.00",
              endgamePoints: "0.00",
              notes: null,
              createdAt: "2026-02-11T00:00:00.000Z",
            },
            {
              id: "m4",
              seasonYear: 2026,
              occurredOn: "2026-02-12",
              matchKey: "qm4",
              eventKey: null,
              autoPoints: "7.00",
              teleopPoints: "17.00",
              endgamePoints: "0.00",
              notes: null,
              createdAt: "2026-02-12T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("UPDATE code_perf_changes")) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await analyzeChange(client, { orgId: ORG, userId: USER, changeId: "change-1" });

    const changeUpdate = updates.find((entry) => entry.sql.includes("UPDATE code_perf_changes"));
    expect(changeUpdate).toBeDefined();
    // Auto avg 3.5 -> 6.5 (+3), teleop avg 10.5 -> 16.5 (+6): total +9 -> improved.
    expect(changeUpdate?.params).toContain("improved");

    const usageInsert = updates.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
