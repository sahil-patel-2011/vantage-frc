import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAdapter, ContextItem } from "../src";
import { annotateToolOutput, toolOutputsToContextContent } from "../src/auto-tools";
import {
  sanitizeErrorMessage,
  summarizeJson,
  truncateField,
} from "../src/autonomous-agent-store";
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
  it("parses ReAct JSON actions", async () => {
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

  it("calls tools then injects results into the next model step", async () => {
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
    expect(result.steps.some((s) => s.kind === "tool" && s.toolName === "web.search")).toBe(true);
    expect(result.steps.some((s) => s.kind === "observe")).toBe(true);
    expect(result.finalAnswer).toMatch(/setup|honestly/i);
    expect(seenContexts.length).toBeGreaterThanOrEqual(2);
    const second = seenContexts[1] ?? [];
    expect(second.some((c) => c.type === "module_fact" && c.content.includes("web.search"))).toBe(
      true,
    );
    expect(second.some((c) => c.id === "org-session" || c.content.includes("FRC team number"))).toBe(
      true,
    );
  });
});
