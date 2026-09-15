import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAdapter, ContextItem } from "../src";
import { annotateToolOutput, toolOutputsToContextContent } from "../src/auto-tools";
import {
  cancelAutonomousRun,
  clampAutonomousMaxSteps,
  DEFAULT_MAX_STEPS,
  failStaleRunningAutonomousRuns,
  findRunningAutonomousRunByGoal,
  finishAutonomousRun,
  HARD_MAX_STEPS,
  nextAutonomousStepSequence,
  readAutonomousRunStatus,
  reopenAutonomousHopTransaction,
  sanitizeErrorMessage,
  summarizeJson,
  truncateField,
} from "../src/autonomous-agent-store";
import { WORKING_GOAL_ITEM_ID } from "../src/working-memory";
import {
  collectExplicitTodoMarks,
  conservativeTodoMarksFromTool,
  mergeTodoMarks,
} from "../src/autonomous-todo-progress";
import {
  assertSafeFetchUrl,
  isAllowlistedFetchHost,
  isBlockedPrivateIp,
  WEB_FETCH_HOST_ALLOWLIST,
} from "../src/safe-web-fetch";
import {
  executeWebFetch,
  executeWebSearch,
  resolveWebSearchProvider,
} from "../src/web-tools";

vi.mock("@vantage/billing", async () => {
  const actual = await vi.importActual<typeof import("@vantage/billing")>("@vantage/billing");
  return {
    ...actual,
    meteredAI: vi.fn(async (input: { invoke: () => Promise<{ value: string }> }) => {
      const result = await input.invoke();
      return result.value;
    }),
    loadOrgAiPolicy: vi.fn(async () => ({
      featureAllowlistEnabled: false,
      allowedFeatures: [],
      toolAllowlistEnabled: false,
      allowedTools: [],
      financeInAiEnabled: false,
      financeInAiAcceptedAt: null,
      financeInAiAckVersion: null,
      requireApprovalForFeatures: [],
      requireApprovalAboveThreshold: false,
      highCostThresholdUsd: null,
      adminBypassApproval: true,
    })),
    isToolAllowed: vi.fn(() => true),
  };
});

describe("SSRF guards for autonomous web fetch", () => {
  it("blocks private and metadata IPs", () => {
    expect(isBlockedPrivateIp("127.0.0.1")).toBe(true);
    expect(isBlockedPrivateIp("10.0.0.5")).toBe(true);
    expect(isBlockedPrivateIp("192.168.1.1")).toBe(true);
    expect(isBlockedPrivateIp("169.254.169.254")).toBe(true);
    expect(isBlockedPrivateIp("8.8.8.8")).toBe(false);
  });

  it("only allowlists public FRC doc hosts", () => {
    expect(isAllowlistedFetchHost("www.thebluealliance.com")).toBe(true);
    expect(isAllowlistedFetchHost("docs.wpilib.org")).toBe(true);
    expect(isAllowlistedFetchHost("evil.example.com")).toBe(false);
    expect(WEB_FETCH_HOST_ALLOWLIST.length).toBeGreaterThan(5);
  });

  it("rejects http, credentials, and non-allowlisted hosts", async () => {
    await expect(assertSafeFetchUrl("http://www.thebluealliance.com/")).rejects.toThrow(/https/i);
    await expect(assertSafeFetchUrl("https://user:pass@www.thebluealliance.com/")).rejects.toThrow(
      /credential/i,
    );
    await expect(assertSafeFetchUrl("https://example.com/")).rejects.toThrow(/allowlist/i);
  });
});

describe("web search / fetch setup_required", () => {
  it("resolves Brave or RESEARCH_SEARCH providers", () => {
    expect(resolveWebSearchProvider({}).kind).toBeNull();
    expect(resolveWebSearchProvider({ BRAVE_SEARCH_API_KEY: "x" }).kind).toBe("brave");
    expect(
      resolveWebSearchProvider({
        RESEARCH_SEARCH_ENDPOINT: "https://search.example/v1",
        RESEARCH_SEARCH_API_KEY: "k",
      }).kind,
    ).toBe("http_json");
  });

  it("returns setup_required when no search key", async () => {
    const result = await executeWebSearch({ query: "FRC bumpers" }, { env: {} });
    expect(result.status).toBe("setup_required");
    expect(result.results).toEqual([]);
  });

  it("returns setup_required when browse disabled", async () => {
    const result = await executeWebFetch(
      { url: "https://www.thebluealliance.com/team/1111" },
      { env: { AGENT_WEB_BROWSE_ENABLED: "false" } },
    );
    expect(result.status).toBe("setup_required");
  });
});

describe("tool-result injection helpers", () => {
  it("parses ReAct JSON actions", { timeout: 15_000 }, async () => {
    const { parseAutonomousAgentAction } = await import("../src/autonomous-loop");
    expect(parseAutonomousAgentAction('{"type":"final","answer":"Done"}')).toEqual({
      type: "final",
      answer: "Done",
    });
    expect(
      parseAutonomousAgentAction(
        'Here:\n```json\n{"type":"tool_call","tool":"web.search","input":{"query":"rules"}}\n```',
      ),
    ).toEqual({
      type: "tool_call",
      tool: "web.search",
      input: { query: "rules" },
    });
    expect(parseAutonomousAgentAction("not json")).toBeNull();
  });

  it("injects annotated tool outputs as module_fact context", () => {
    const annotated = annotateToolOutput(
      "web.search",
      {
        status: "ok",
        provider: "brave",
        results: [{ title: "TBA", url: "https://www.thebluealliance.com/", snippet: "x" }],
      },
      { query: "TBA" },
    );
    expect(annotated.status).toBe("ok");
    const ctx = toolOutputsToContextContent([annotated]);
    expect(ctx[0]?.type).toBe("module_fact");
    expect(ctx[0]?.content).toContain("web.search");
    expect(ctx[0]?.content).toContain("thebluealliance");
  });

  it("truncates and redacts before persistence", () => {
    expect(truncateField("abc", 2)).toBe("ab");
    expect(sanitizeErrorMessage("Bearer sk-abcdefghijklmnop failed")).toContain("[redacted]");
    expect(summarizeJson({ a: 1 })?.includes('"a"')).toBe(true);
  });
});

describe("autonomous ReAct loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls tools then injects results into the next model step", { timeout: 20_000 }, async () => {
    const { runAutonomousAgent } = await import("../src/autonomous-loop");
    const seenContexts: ContextItem[][] = [];
    let call = 0;
    const adapter: ChatAdapter = {
      provider: "test",
      model: "loop-v1",
      async complete(input) {
        seenContexts.push(input.context);
        call += 1;
        if (call === 1) {
          return {
            text: JSON.stringify({
              type: "tool_call",
              tool: "web.search",
              input: { query: "FRC game manual" },
            }),
            promptTokens: 10,
            completionTokens: 10,
            costUsd: 0,
          };
        }
        return {
          text: JSON.stringify({
            type: "final",
            answer: "Search needed setup; stopping honestly.",
          }),
          promptTokens: 12,
          completionTokens: 8,
          costUsd: 0,
        };
      },
    };

    const client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (/INSERT INTO autonomous_agent_runs/i.test(text)) {
          return { rows: [{ id: "run-1" }], rowCount: 1 };
        }
        if (/INSERT INTO autonomous_agent_steps/i.test(text)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE autonomous_agent_runs/i.test(text)) {
          return { rows: [], rowCount: 1 };
        }
        if (/FROM org_active_context/i.test(text)) {
          return { rows: [{ active_event_key: null }], rowCount: 1 };
        }
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
        if (/FROM ai_usage_events/i.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await runAutonomousAgent({
      client: client as never,
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      goal: "Find bumper rules",
      adapter,
      requestId: "req-loop-1",
      maxSteps: 4,
    });

    expect(result.runId).toBe("run-1");
    expect(result.resumed).toBe(false);
    expect(result.steps.some((s) => s.kind === "tool" && s.toolName === "web.search")).toBe(true);
    expect(result.steps.some((s) => s.kind === "observe")).toBe(true);
    expect(result.finalAnswer).toMatch(/setup|honestly/i);
    expect(seenContexts.length).toBeGreaterThanOrEqual(2);
    const first = seenContexts[0] ?? [];
    expect(first.some((c) => c.id === WORKING_GOAL_ITEM_ID && c.content.includes("Find bumper rules"))).toBe(
      true,
    );
    const second = seenContexts[1] ?? [];
    expect(second.some((c) => c.id === WORKING_GOAL_ITEM_ID)).toBe(true);
    expect(second.some((c) => c.type === "module_fact" && c.content.includes("web.search"))).toBe(
      true,
    );
    expect(second.some((c) => c.id === "org-session" || c.content.includes("FRC team number"))).toBe(
      true,
    );
    expect(client.query.mock.calls.some(([sql]) => String(sql) === "COMMIT")).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("set_config('app.user_id'"))).toBe(
      true,
    );
  });

  it("resumes a running run from max(sequence)+1 and keeps the pinned goal", { timeout: 20_000 }, async () => {
    const { runAutonomousAgent } = await import("../src/autonomous-loop");
    const seenContexts: ContextItem[][] = [];
    const adapter: ChatAdapter = {
      provider: "test",
      model: "loop-v1",
      async complete(input) {
        seenContexts.push(input.context);
        return {
          text: JSON.stringify({
            type: "final",
            answer: "Resumed from the prior tool hop and finished.",
          }),
          promptTokens: 8,
          completionTokens: 6,
          costUsd: 0,
        };
      },
    };

    const orgId = "00000000-0000-0000-0000-000000000001";
    const userId = "00000000-0000-0000-0000-000000000002";
    const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const goal = "Find bumper rules";
    const inserted: { sequence: number; kind: string }[] = [];
    let insertedNewRun = false;

    const runRow = {
      id: runId,
      orgId,
      userId,
      goal,
      status: "running" as const,
      feature: "agent",
      requestId: "req-old",
      provider: "test",
      model: "loop-v1",
      stepCount: 3,
      maxSteps: 8,
      finalAnswer: null,
      errorClass: null,
      errorMessage: null,
      usageEventIds: [],
      startedAt: "2026-09-14T00:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-09-14T00:00:00.000Z",
    };
    const existingSteps = [
      {
        id: "s0",
        orgId,
        runId,
        sequence: 0,
        kind: "plan",
        toolName: null,
        argsSummary: null,
        resultSummary: "prior plan",
        resultExcerpt: null,
        sourceUrl: null,
        status: "ok",
        requestId: null,
        usageEventId: null,
        createdAt: "2026-09-14T00:00:00.000Z",
      },
      {
        id: "s1",
        orgId,
        runId,
        sequence: 1,
        kind: "tool",
        toolName: "web.search",
        argsSummary: '{"query":"Find bumper rules"}',
        resultSummary: "search setup_required",
        resultExcerpt: "Brave key missing",
        sourceUrl: null,
        status: "setup_required",
        requestId: null,
        usageEventId: null,
        createdAt: "2026-09-14T00:00:01.000Z",
      },
      {
        id: "s2",
        orgId,
        runId,
        sequence: 2,
        kind: "observe",
        toolName: "web.search",
        argsSummary: null,
        resultSummary: "injected",
        resultExcerpt: null,
        sourceUrl: null,
        status: "setup_required",
        requestId: null,
        usageEventId: null,
        createdAt: "2026-09-14T00:00:02.000Z",
      },
    ];

    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = String(sql);
        if (/FROM autonomous_agent_runs/i.test(text) && /status = 'running'/i.test(text)) {
          return { rows: [runRow], rowCount: 1 };
        }
        if (/FROM autonomous_agent_runs/i.test(text) && /id = \$1::uuid/i.test(text)) {
          return { rows: [runRow], rowCount: 1 };
        }
        if (/FROM autonomous_agent_steps/i.test(text) && /ORDER BY sequence/i.test(text)) {
          return { rows: existingSteps, rowCount: existingSteps.length };
        }
        if (/INSERT INTO autonomous_agent_runs/i.test(text)) {
          insertedNewRun = true;
          return { rows: [{ id: "run-new" }], rowCount: 1 };
        }
        if (/INSERT INTO autonomous_agent_steps/i.test(text)) {
          inserted.push({ sequence: Number(params[2]), kind: String(params[3]) });
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE autonomous_agent_runs/i.test(text)) {
          return { rows: [], rowCount: 1 };
        }
        if (/FROM org_active_context/i.test(text)) {
          return { rows: [{ active_event_key: null }], rowCount: 1 };
        }
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
        if (/FROM ai_usage_events/i.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await runAutonomousAgent({
      client: client as never,
      orgId,
      userId,
      goal,
      adapter,
      requestId: "req-resume-1",
      maxSteps: 24,
    });

    expect(insertedNewRun).toBe(false);
    expect(result.resumed).toBe(true);
    expect(result.runId).toBe(runId);
    expect(result.steps.some((step) => step.sequence === 0 && step.kind === "plan")).toBe(true);
    expect(inserted[0]).toEqual({ sequence: 3, kind: "plan" });
    expect(inserted.every((step) => step.sequence >= 3)).toBe(true);
    expect(seenContexts[0]?.some((c) => c.id === WORKING_GOAL_ITEM_ID && c.content.includes(goal))).toBe(
      true,
    );
    expect(seenContexts[0]?.some((c) => c.content.includes("web.search"))).toBe(true);
  });

  it("resumes an explicit running runId from the next sequence", { timeout: 20_000 }, async () => {
    const { runAutonomousAgent } = await import("../src/autonomous-loop");
    const adapter: ChatAdapter = {
      provider: "test",
      model: "loop-v1",
      async complete() {
        return {
          text: JSON.stringify({ type: "final", answer: "Done after explicit resume." }),
          promptTokens: 4,
          completionTokens: 4,
          costUsd: 0,
        };
      },
    };
    const orgId = "00000000-0000-0000-0000-000000000001";
    const userId = "00000000-0000-0000-0000-000000000002";
    const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const inserted: number[] = [];
    const runRow = {
      id: runId,
      orgId,
      userId,
      goal: "Find bumper rules",
      status: "running",
      feature: "agent",
      requestId: "req-old",
      provider: "test",
      model: "loop-v1",
      stepCount: 1,
      maxSteps: 8,
      finalAnswer: null,
      errorClass: null,
      errorMessage: null,
      usageEventIds: [],
      startedAt: "2026-09-14T00:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-09-14T00:00:00.000Z",
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = String(sql);
        if (/FROM autonomous_agent_runs/i.test(text) && /id = \$1::uuid/i.test(text)) {
          return { rows: [runRow], rowCount: 1 };
        }
        if (/FROM autonomous_agent_steps/i.test(text)) {
          return {
            rows: [
              {
                id: "s0",
                orgId,
                runId,
                sequence: 4,
                kind: "plan",
                toolName: null,
                argsSummary: null,
                resultSummary: "older hop",
                resultExcerpt: null,
                sourceUrl: null,
                status: "ok",
                requestId: null,
                usageEventId: null,
                createdAt: "2026-09-14T00:00:00.000Z",
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO autonomous_agent_runs/i.test(text)) {
          throw new Error("should not insert a new run when runId is resumable");
        }
        if (/INSERT INTO autonomous_agent_steps/i.test(text)) {
          inserted.push(Number(params[2]));
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE autonomous_agent_runs/i.test(text) || /FROM org_active_context/i.test(text)) {
          return { rows: [{ active_event_key: null }], rowCount: 1 };
        }
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

    const result = await runAutonomousAgent({
      client: client as never,
      orgId,
      userId,
      goal: "Find bumper rules",
      adapter,
      requestId: "req-explicit",
      runId,
    });
    expect(result.resumed).toBe(true);
    expect(result.runId).toBe(runId);
    expect(inserted[0]).toBe(5);
  });
});

describe("autonomous step caps and resume helpers", () => {
  it("defaults to 24 hops and hard-caps at 48", () => {
    expect(DEFAULT_MAX_STEPS).toBe(24);
    expect(HARD_MAX_STEPS).toBe(48);
    expect(clampAutonomousMaxSteps()).toBe(24);
    expect(clampAutonomousMaxSteps(8)).toBe(8);
    expect(clampAutonomousMaxSteps(99)).toBe(48);
    expect(clampAutonomousMaxSteps(0)).toBe(1);
  });

  it("COMMITs the hop then re-opens RLS SET LOCAL so GET can poll live steps", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    };
    await reopenAutonomousHopTransaction(client as never, "user-1", "org-1");
    expect(queries[0]?.sql).toBe("COMMIT");
    expect(queries[1]?.sql).toBe("BEGIN");
    expect(queries[2]?.sql).toContain("set_config('app.user_id'");
    expect(queries[2]?.params).toEqual(["user-1"]);
    expect(queries[3]?.sql).toContain("set_config('app.org_id'");
    expect(queries[3]?.params).toEqual(["org-1"]);
  });

  it("ships a migration that lifts the 0427 1..20 check to 1..48 with default 24", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "db", "migrations", "0659_autonomous_max_steps.sql"),
      "utf8",
    );
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS autonomous_agent_runs_max_steps_check/);
    expect(sql).toMatch(/SET DEFAULT 24/);
    expect(sql).toMatch(/BETWEEN 1 AND 48/);
  });

  it("derives the next sequence from max(sequence)+1", () => {
    expect(nextAutonomousStepSequence([])).toBe(0);
    expect(nextAutonomousStepSequence([{ sequence: 0 }, { sequence: 4 }])).toBe(5);
  });

  it("finds a running run by user/org/goal with parameterized SQL", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as never[] }));
    await findRunningAutonomousRunByGoal(
      { query } as never,
      {
        orgId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        goal: "Find bumper rules",
      },
    );
    expect(query.mock.calls[0]?.[0]).toMatch(/org_id = \$1::uuid/);
    expect(query.mock.calls[0]?.[0]).toMatch(/user_id = \$2::uuid/);
    expect(query.mock.calls[0]?.[0]).toMatch(/status = 'running'/);
    expect(query.mock.calls[0]?.[0]).toMatch(/goal = \$3/);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "Find bumper rules",
    ]);
  });

  it("fails only stale other-goal running runs when starting a new goal", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [] as never[],
      rowCount: 2,
    }));
    const n = await failStaleRunningAutonomousRuns(
      { query } as never,
      {
        orgId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        currentGoal: "New goal about strategy",
      },
    );
    expect(n).toBe(2);
    expect(query.mock.calls[0]?.[0]).toMatch(/make_interval\(mins => \$3::integer\)/);
    expect(query.mock.calls[0]?.[0]).toMatch(/goal IS DISTINCT FROM \$4/);
    expect(query.mock.calls[0]?.[1]?.[2]).toBe(15);
    expect(query.mock.calls[0]?.[1]?.[3]).toBe("New goal about strategy");
  });

  it("cancels only the caller's running row and finish refuses to overwrite cancelled", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (/UPDATE autonomous_agent_runs/.test(sql) && /cancelled/.test(sql)) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000099",
              orgId: "00000000-0000-0000-0000-000000000001",
              userId: "00000000-0000-0000-0000-000000000002",
              goal: "Stop this",
              status: "cancelled",
              feature: "agent",
              requestId: "r1",
              provider: null,
              model: null,
              stepCount: 1,
              maxSteps: 24,
              finalAnswer: null,
              errorClass: "cancelled",
              errorMessage: "Stopped by the team",
              usageEventIds: [],
              startedAt: "2026-09-15T00:00:00.000Z",
              finishedAt: "2026-09-15T00:01:00.000Z",
              createdAt: "2026-09-15T00:00:00.000Z",
            },
          ],
        };
      }
      if (/SELECT status FROM autonomous_agent_runs/.test(sql)) {
        return { rows: [{ status: "cancelled" }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const cancelled = await cancelAutonomousRun(
      { query } as never,
      {
        orgId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        runId: "00000000-0000-4000-8000-000000000099",
      },
    );
    expect(cancelled?.status).toBe("cancelled");
    expect(query.mock.calls[0]?.[0]).toMatch(/status = 'running'/);
    expect(query.mock.calls[0]?.[0]).toMatch(/user_id = \$3::uuid/);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "00000000-0000-4000-8000-000000000099",
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "Stopped by the team",
    ]);
    expect(await readAutonomousRunStatus({ query } as never, {
      orgId: "00000000-0000-0000-0000-000000000001",
      runId: "00000000-0000-4000-8000-000000000099",
    })).toBe("cancelled");
    await finishAutonomousRun({ query } as never, {
      runId: "00000000-0000-4000-8000-000000000099",
      status: "completed",
      stepCount: 2,
      finalAnswer: "should not overwrite",
    });
    const finishSql = query.mock.calls.find((call) => /step_count = \$3/.test(String(call[0])))?.[0];
    expect(finishSql).toMatch(/AND status = 'running'/);
  });
});

describe("autonomous todo progress", () => {
  const todos = [
    { id: "t1", label: "Search FRC bumper rules", status: "pending" as const },
    { id: "t2", label: "Fetch the game manual", status: "pending" as const },
  ];

  it("marks done only from explicit model JSON", () => {
    const payload = {
      type: "tool_call",
      tool: "web.search",
      input: { query: "unrelated" },
      todos: [{ id: "t1", status: "done" }],
    };
    expect(collectExplicitTodoMarks(payload, todos)).toEqual([{ todoId: "t1", status: "done" }]);
  });

  it("conservatively marks in_progress from a full label match and never invents done", () => {
    const inferred = conservativeTodoMarksFromTool({
      todos,
      toolName: "web.search",
      toolInput: { query: "Search FRC bumper rules" },
      toolSummary: "2 search hit(s)",
    });
    expect(inferred).toEqual([{ todoId: "t1", status: "in_progress" }]);
    const merged = mergeTodoMarks([], inferred);
    expect(merged.some((mark) => mark.status === "done")).toBe(false);
  });

  it("does not invent completion from a weak token overlap", () => {
    expect(
      conservativeTodoMarksFromTool({
        todos,
        toolName: "web.search",
        toolInput: { query: "rules" },
        toolSummary: "ok",
      }),
    ).toEqual([]);
    expect(
      collectExplicitTodoMarks({ type: "tool_call", tool: "web.search", input: {} }, todos),
    ).toEqual([]);
  });
});
