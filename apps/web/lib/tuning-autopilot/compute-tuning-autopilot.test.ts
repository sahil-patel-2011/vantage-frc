import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeTuningAutopilotView, logIteration } from "./compute-tuning-autopilot";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeTuningAutopilotView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeTuningAutopilotView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.map((s) => s.id)).toEqual(
        expect.arrayContaining(["workspace", "cad", "fmea", "practice"]),
      );
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      expect(view.steps.some((s) => /never DEMO/i.test(s.detail))).toBe(true);
    }
  });

  it("returns a live view with scored iterations and a next-gain suggestion", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM tuning_autopilot_sessions") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: SESSION,
              seasonYear: 2026,
              subsystem: "Arm",
              controllerType: "pid",
              goal: "No overshoot, settle under 0.5s",
              status: "active",
              createdAt: "2026-02-01T00:00:00.000Z",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM tuning_autopilot_iterations")) {
        return {
          rows: [
            {
              id: "iter-1",
              sessionId: SESSION,
              iterationIndex: 0,
              kP: "0.05",
              kI: "0",
              kD: "0",
              kS: "0",
              kV: "0",
              kG: "0",
              overshootPct: "22",
              settlingTimeSec: "1.4",
              steadyStateError: "0.02",
              oscillating: true,
              notes: "First pass, too aggressive",
              loggedBy: USER,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeTuningAutopilotView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.sessions).toHaveLength(1);
    expect(view.iterations).toHaveLength(1);
    expect(view.iterations[0]?.score).toBeLessThan(0.5);
    expect(view.suggestion).not.toBeNull();
    expect(view.suggestion?.gains.kP).toBeLessThan(0.05);
    expect(view.suggestion?.rationale.join(" ")).toContain("oscillated");
  });
});

describe("logIteration", () => {
  it("persists an iteration and returns a deterministic suggestion grounded in the logged trend", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("COALESCE(MAX(iteration_index)")) {
        return { rows: [{ nextIndex: "1" }] };
      }
      if (sql.includes("INSERT INTO tuning_autopilot_iterations")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("UPDATE tuning_autopilot_sessions")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT id, session_id AS")) {
        return {
          rows: [
            {
              id: "iter-1",
              sessionId: SESSION,
              iterationIndex: 0,
              kP: "0.05",
              kI: "0",
              kD: "0",
              kS: "0",
              kV: "0",
              kG: "0",
              overshootPct: "22",
              settlingTimeSec: "1.4",
              steadyStateError: "0.02",
              oscillating: true,
              notes: "First pass",
              loggedBy: USER,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "iter-2",
              sessionId: SESSION,
              iterationIndex: 1,
              kP: "0.03",
              kI: "0",
              kD: "0",
              kS: "0",
              kV: "0",
              kG: "0",
              overshootPct: "2",
              settlingTimeSec: "0.3",
              steadyStateError: "0.005",
              oscillating: false,
              notes: "Reduced kP, clean response",
              loggedBy: USER,
              createdAt: "2026-02-02T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const suggestion = await logIteration(client, {
      orgId: ORG,
      userId: USER,
      sessionId: SESSION,
      gains: { kP: 0.03, kI: 0, kD: 0, kS: 0, kV: 0, kG: 0 },
      result: { overshootPct: 2, settlingTimeSec: 0.3, steadyStateError: 0.005, oscillating: false },
      notes: "Reduced kP, clean response",
    });

    const iterationInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO tuning_autopilot_iterations"));
    expect(iterationInsert).toBeDefined();
    expect(iterationInsert?.params[2]).toBe(1);

    expect(suggestion).not.toBeNull();
    expect(suggestion?.converged).toBe(true);
    expect(suggestion?.gains.kP).toBe(0.03);

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
