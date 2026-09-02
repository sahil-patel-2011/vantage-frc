/**
 * Autonomous run lifecycle (0498): the route inserts the run row and answers {runId}
 * immediately; the loop then executes against that row one committed transaction per
 * step (`transact`), so steps are visible to a polling reader as they land, and a
 * cooperative cancel flag is honoured between steps.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChatAdapter } from "../src";

vi.mock("@vantage/billing", async () => {
  const actual = await vi.importActual<typeof import("@vantage/billing")>("@vantage/billing");
  return {
    ...actual,
    meteredAI: vi.fn(async (input: { invoke: () => Promise<{ value: string }> }) => {
      const result = await input.invoke();
      return result.value;
    }),
    loadOrgAiPolicy: vi.fn(async () => null),
    isToolAllowed: vi.fn(() => true),
  };
});

const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";

type Call = { sql: string; params: unknown[] };

function makeClient(options: { cancelAfterSteps?: number } = {}) {
  const calls: Call[] = [];
  let stepInserts = 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/INSERT INTO autonomous_agent_runs/i.test(text)) {
        throw new Error("the loop must not insert a run when runId is supplied");
      }
      if (/INSERT INTO autonomous_agent_steps/i.test(text)) {
        stepInserts += 1;
        return { rows: [], rowCount: 1 };
      }
      if (/to_jsonb\(autonomous_agent_runs\)/i.test(text)) {
        const cancelled =
          options.cancelAfterSteps !== undefined && stepInserts >= options.cancelAfterSteps;
        return {
          rows: [{ cancelRequestedAt: cancelled ? "2026-09-02T00:00:00.000Z" : null, status: "running" }],
          rowCount: 1,
        };
      }
      if (/UPDATE autonomous_agent_runs/i.test(text)) return { rows: [], rowCount: 1 };
      if (/FROM org_active_context/i.test(text)) return { rows: [{ active_event_key: null }], rowCount: 1 };
      if (/FROM organizations o/i.test(text)) {
        return {
          rows: [
            {
              orgName: "Test Org",
              teamNumber: 1111,
              teamAffiliation: null,
              schoolFunded: null,
              sponsorsAllowed: null,
              activeEventKey: null,
              seasonYear: 2026,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client, calls };
}

function toolThenFinalAdapter(seen: { completes: number; stepInsertsAtCall: number[] }, countSteps: () => number): ChatAdapter {
  return {
    provider: "test",
    model: "loop-v1",
    async complete() {
      seen.completes += 1;
      seen.stepInsertsAtCall.push(countSteps());
      if (seen.completes === 1) {
        return {
          text: JSON.stringify({ type: "tool_call", tool: "web.search", input: { query: "bumper rules" } }),
          promptTokens: 10,
          completionTokens: 10,
          costUsd: 0,
        };
      }
      return {
        text: JSON.stringify({ type: "final", answer: "Done honestly." }),
        promptTokens: 12,
        completionTokens: 8,
        costUsd: 0,
      };
    },
  };
}

// The dynamic import plus four fake model turns takes ~2s alone and >5s when the
// whole suite is loading the machine — give it room so load cannot fail it.
describe("runAutonomousAgent lifecycle", { timeout: 20_000 }, () => {
  it("executes against a pre-created run, one transaction per step, persisting steps before the next model call", async () => {
    const { runAutonomousAgent } = await import("../src/autonomous-loop");
    const { client, calls } = makeClient();
    const stepInsertsSoFar = () =>
      calls.filter((call) => /INSERT INTO autonomous_agent_steps/i.test(call.sql)).length;
    const seen = { completes: 0, stepInsertsAtCall: [] as number[] };
    const transactions: number[] = [];
    let openTransactions = 0;

    const result = await runAutonomousAgent({
      client: client as never,
      orgId: ORG,
      userId: USER,
      goal: "Find bumper rules",
      adapter: toolThenFinalAdapter(seen, stepInsertsSoFar),
      requestId: "req-lifecycle-1",
      maxSteps: 4,
      runId: "run-pre",
      transact: async (work) => {
        openTransactions += 1;
        expect(openTransactions).toBe(1); // steps never overlap
        try {
          return await work(client as never);
        } finally {
          openTransactions -= 1;
          transactions.push(stepInsertsSoFar());
        }
      },
    });

    expect(result.runId).toBe("run-pre");
    // web.search has no key in tests, so the tool reports setup_required and the run says so.
    expect(["completed", "setup_required"]).toContain(result.status);
    expect(result.finalAnswer).toBe("Done honestly.");
    // Prelude + cancel checks + per-step work each ran in their own transaction.
    expect(transactions.length).toBeGreaterThanOrEqual(4);
    // The second model call only happened after the first step's rows (plan, tool,
    // observe) were persisted — a poller sees them before the loop continues.
    expect(seen.completes).toBe(2);
    expect(seen.stepInsertsAtCall[0]).toBe(0);
    expect(seen.stepInsertsAtCall[1]).toBeGreaterThanOrEqual(3);
    // The run row's step_count is kept current between steps for the poller.
    expect(calls.some((call) => /SET step_count = \$2/i.test(call.sql))).toBe(true);
    // Never re-inserted the run: the route owns that row.
    expect(calls.some((call) => /INSERT INTO autonomous_agent_runs/i.test(call.sql))).toBe(false);
  });

  it("honours a cancel requested between steps and finishes the run as cancelled", async () => {
    const { runAutonomousAgent } = await import("../src/autonomous-loop");
    // Cancel becomes visible once the first step's rows (plan + tool + observe) exist.
    const { client, calls } = makeClient({ cancelAfterSteps: 3 });
    const stepInsertsSoFar = () =>
      calls.filter((call) => /INSERT INTO autonomous_agent_steps/i.test(call.sql)).length;
    const seen = { completes: 0, stepInsertsAtCall: [] as number[] };

    const result = await runAutonomousAgent({
      client: client as never,
      orgId: ORG,
      userId: USER,
      goal: "Find bumper rules",
      adapter: toolThenFinalAdapter(seen, stepInsertsSoFar),
      requestId: "req-lifecycle-2",
      maxSteps: 4,
      runId: "run-cancel",
      transact: (work) => work(client as never),
    });

    expect(result.status).toBe("cancelled");
    expect(result.errorClass).toBe("cancelled");
    expect(result.finalAnswer).toBeNull();
    // The model was not called again after the cancel was seen.
    expect(seen.completes).toBe(1);
    const finish = calls.find(
      (call) => /UPDATE autonomous_agent_runs/i.test(call.sql) && call.params.includes("cancelled"),
    );
    expect(finish).toBeDefined();
  });
});
