import { describe, expect, it, vi } from "vitest";
import type { ContextItem } from "../src/index";
import {
  BRIDGE_HEAVY_CLI_TIMEOUT_MS,
  BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS,
  BRIDGE_INTERACTIVE_CLI_TIMEOUT_MS,
  BRIDGE_MAX_WAIT_ENV,
  BRIDGE_MAX_WAIT_MAX_MS,
  BRIDGE_MAX_WAIT_MIN_MS,
  BRIDGE_POLL_DELAYS_MS,
  BRIDGE_PROMPT_MAX_CHARS,
  SubscriptionBridgeChatAdapter,
  SubscriptionBridgeError,
  bridgeHeavyCliTimeoutMs,
  bridgeHeavyPollBudgetMs,
  buildBridgePromptDocument,
  degradedReasonForErrorClass,
  nextBridgePollDelay,
  type SubscriptionBridgeTransport,
} from "../src/subscription-bridge-adapter";
import { resolveOrgChatAdapterWithProvenance } from "../src/resolve-chat-adapter";
import { HttpChatAdapter } from "../src/http-chat-adapter";

/** The bridge service is stdlib-only ESM — import its pure helpers directly. */
const bridgeModule = () =>
  import(new URL("../../ai-bridge/bridge.mjs", import.meta.url).href) as Promise<{
    detectRateLimit(text: string): { rateLimited: boolean; resetText: string | null };
    parseClaudeCliOutput(stdout: string): {
      ok: boolean;
      text?: string;
      model?: string | null;
      usage?: { inputTokens: number; outputTokens: number };
      errorClass?: string;
      errorMessage?: string;
      resetText?: string | null;
    };
    pickEngine(
      engines: Record<string, { available?: boolean } | undefined>,
      requested: string | null,
    ): string | null;
  }>;

/**
 * Captured VERBATIM from a real `claude -p --output-format json --tools "" \
 * --no-session-persistence --disable-slash-commands` run (Claude Code 2.1.241,
 * Windows, 2026-08-24). Note the CLI exits 0 even for this error — failures must
 * be read from the JSON.
 */
const REAL_NOT_LOGGED_IN_FIXTURE = `{"is_error":true,"duration_api_ms":0,"num_turns":1,"stop_reason":"stop_sequence","session_id":"2d90a1b2-5d41-462f-a3a4-d81bc5b2063d","total_cost_usd":0,"usage":{"output_tokens_details":{"thinking_tokens":0},"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{},"permission_denials":[],"terminal_reason":"api_error","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"subtype":"success","api_error_status":null,"result":"Not logged in · Please run /login","type":"result","duration_ms":337,"uuid":"7ff2494b-b7ee-40cb-98f7-8ff6a75bbb2e"}`;

/** Success-shaped output following the exact schema observed above (is_error false). */
const SUCCESS_FIXTURE = JSON.stringify({
  is_error: false,
  type: "result",
  subtype: "success",
  result: "Swerve modules need their azimuth encoders re-zeroed after a gear swap.",
  total_cost_usd: 0,
  usage: { input_tokens: 812, output_tokens: 96, cache_read_input_tokens: 640 },
  modelUsage: { "claude-fable-5": { inputTokens: 812, outputTokens: 96 } },
});

const RATE_LIMIT_FIXTURE = JSON.stringify({
  is_error: true,
  type: "result",
  result: "5-hour limit reached · Your limit will reset at 7:00 PM (America/New_York).",
  usage: { input_tokens: 0, output_tokens: 0 },
  modelUsage: {},
});

describe("bridge CLI output parsing (bridge.mjs)", () => {
  it("classifies the real not-logged-in output as not_authenticated", async () => {
    const bridge = await bridgeModule();
    const parsed = bridge.parseClaudeCliOutput(REAL_NOT_LOGGED_IN_FIXTURE);
    expect(parsed.ok).toBe(false);
    expect(parsed.errorClass).toBe("not_authenticated");
    expect(parsed.errorMessage).toContain("Not logged in");
  });

  it("parses a successful turn: text, model from modelUsage, real token usage", async () => {
    const bridge = await bridgeModule();
    const parsed = bridge.parseClaudeCliOutput(SUCCESS_FIXTURE);
    expect(parsed.ok).toBe(true);
    expect(parsed.text).toContain("azimuth encoders");
    expect(parsed.model).toBe("claude-fable-5");
    expect(parsed.usage).toMatchObject({ inputTokens: 812, outputTokens: 96 });
  });

  it("classifies rate-limit output and surfaces the reset text verbatim", async () => {
    const bridge = await bridgeModule();
    const parsed = bridge.parseClaudeCliOutput(RATE_LIMIT_FIXTURE);
    expect(parsed.errorClass).toBe("rate_limited");
    expect(parsed.errorMessage).toContain("reset at 7:00 PM (America/New_York)");
    const limit = bridge.detectRateLimit("Your limit will reset at 7:00 PM (America/New_York).");
    expect(limit.rateLimited).toBe(true);
    expect(limit.resetText).toContain("reset at 7:00 PM");
  });

  it("never throws on non-JSON output — classifies as cli_error", async () => {
    const bridge = await bridgeModule();
    const parsed = bridge.parseClaudeCliOutput("segfault: core dumped");
    expect(parsed.ok).toBe(false);
    expect(parsed.errorClass).toBe("cli_error");
  });

  it("clamps the enqueued per-job CLI budget and defaults when absent", async () => {
    const bridge = (await bridgeModule()) as unknown as {
      jobTimeoutMs(messages: unknown): number;
    };
    expect(bridge.jobTimeoutMs({ timeoutMs: 240_000 })).toBe(240_000);
    expect(bridge.jobTimeoutMs({ timeoutMs: 5 })).toBe(30_000);
    expect(bridge.jobTimeoutMs({ timeoutMs: 99_999_999 })).toBe(300_000);
    expect(bridge.jobTimeoutMs({})).toBe(90_000);
    expect(bridge.jobTimeoutMs(null)).toBe(90_000);
    expect(bridge.jobTimeoutMs({ timeoutMs: "not-a-number" })).toBe(90_000);
  });

  it("picks engines honoring requests and claude-first preference", async () => {
    const bridge = await bridgeModule();
    const both = { claude: { available: true }, codex: { available: true } };
    expect(bridge.pickEngine(both, null)).toBe("claude");
    expect(bridge.pickEngine(both, "codex")).toBe("codex");
    expect(bridge.pickEngine({ codex: { available: true } }, null)).toBe("codex");
    expect(bridge.pickEngine({}, "claude")).toBeNull();
  });
});

describe("prompt document assembly", () => {
  const context: ContextItem[] = [
    { type: "team_memory", id: "mem-1", content: "We run swerve drive.", importance: 5 },
    { type: "module_data", id: "match-42", content: "Match 42: 3 auton coral.", importance: 4 },
  ];

  it("delimits system, each context item, and the user message", () => {
    const doc = buildBridgePromptDocument({ message: "Why did auton fail?", context });
    expect(doc.indexOf("=== SYSTEM ===")).toBe(0);
    expect(doc).toContain("=== TEAM CONTEXT: team_memory (mem-1) ===");
    expect(doc).toContain("=== TEAM CONTEXT: module_data (match-42) ===");
    expect(doc.endsWith("=== USER MESSAGE ===\nWhy did auton fail?\n")).toBe(true);
    expect(doc.indexOf("=== USER MESSAGE ===")).toBeGreaterThan(doc.indexOf("mem-1"));
  });

  it("drops context that would blow the size cap but always keeps the message", () => {
    const huge: ContextItem = {
      type: "artifact",
      id: "huge",
      content: "x".repeat(BRIDGE_PROMPT_MAX_CHARS),
      importance: 9,
    };
    const doc = buildBridgePromptDocument({ message: "short question", context: [huge, ...context] });
    expect(doc).not.toContain("(huge)");
    expect(doc).toContain("short question");
    expect(doc.length).toBeLessThanOrEqual(BRIDGE_PROMPT_MAX_CHARS);
  });
});

describe("poll/expiry maths", () => {
  it("backs off and clamps at the final delay", () => {
    expect(nextBridgePollDelay(0)).toBe(BRIDGE_POLL_DELAYS_MS[0]);
    expect(nextBridgePollDelay(3)).toBe(BRIDGE_POLL_DELAYS_MS[3]);
    expect(nextBridgePollDelay(50)).toBe(BRIDGE_POLL_DELAYS_MS[BRIDGE_POLL_DELAYS_MS.length - 1]);
  });

  it("maps job error classes onto the degraded taxonomy", () => {
    expect(degradedReasonForErrorClass("rate_limited")).toBe("bridge-rate-limited");
    expect(degradedReasonForErrorClass("cli_timeout")).toBe("bridge-timeout");
    expect(degradedReasonForErrorClass("queue_expired")).toBe("bridge-offline");
    expect(degradedReasonForErrorClass("lease_expired")).toBe("bridge-offline");
  });
});

describe("heavy poll budget (VANTAGE_BRIDGE_MAX_WAIT_MS)", () => {
  it("defaults to a budget that leaves real headroom under a 300s function", () => {
    expect(bridgeHeavyPollBudgetMs({})).toBe(BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS);
    expect(BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS).toBe(240_000);
    expect(BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS).toBeLessThan(300_000);
    expect(bridgeHeavyCliTimeoutMs({})).toBe(BRIDGE_HEAVY_CLI_TIMEOUT_MS);
    expect(BRIDGE_HEAVY_CLI_TIMEOUT_MS).toBe(210_000);
  });

  it("honors a valid override for deployments capped below 300s", () => {
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "45000" })).toBe(45_000);
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: " 45000 " })).toBe(45_000);
  });

  it("clamps out-of-range overrides instead of trusting them", () => {
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "1" })).toBe(BRIDGE_MAX_WAIT_MIN_MS);
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "-9000" })).toBe(BRIDGE_MAX_WAIT_MIN_MS);
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "99999999" })).toBe(
      BRIDGE_MAX_WAIT_MAX_MS,
    );
  });

  it("falls back to the default on garbage or blank values", () => {
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "five minutes" })).toBe(
      BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS,
    );
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "" })).toBe(
      BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS,
    );
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: "   " })).toBe(
      BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS,
    );
    expect(bridgeHeavyPollBudgetMs({ [BRIDGE_MAX_WAIT_ENV]: undefined })).toBe(
      BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS,
    );
  });

  it("keeps the CLI timeout meaningfully below the poll budget at every setting", () => {
    for (const raw of [undefined, "45000", "1", "99999999", "garbage", "120000"]) {
      const env = raw === undefined ? {} : { [BRIDGE_MAX_WAIT_ENV]: raw };
      const budget = bridgeHeavyPollBudgetMs(env);
      const cli = bridgeHeavyCliTimeoutMs(env);
      expect(cli, raw).toBeLessThan(budget);
      // Claim + report latency has to fit in the gap, so it is never a token margin.
      expect(budget - cli, raw).toBeGreaterThanOrEqual(Math.min(30_000, budget / 4));
    }
  });
});

function stubTransport(
  poll: SubscriptionBridgeTransport["poll"],
): SubscriptionBridgeTransport & { abandoned: string[] } {
  const abandoned: string[] = [];
  return {
    abandoned,
    enqueue: vi.fn(async () => ({ jobId: "job-1" })),
    poll,
    abandon: vi.fn(async (jobId: string) => {
      abandoned.push(jobId);
    }),
  };
}

const noSleep = async () => {};

describe("SubscriptionBridgeChatAdapter", () => {
  it("returns the bridged answer at $0 cost with real CLI usage and model", async () => {
    const transport = stubTransport(async () => ({
      state: "done",
      result: {
        text: "Re-zero the azimuth encoders.",
        model: "claude-fable-5",
        usage: { inputTokens: 812, outputTokens: 96 },
      },
    }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      requestedEngine: "claude",
      sleep: noSleep,
    });
    const result = await adapter.complete({ message: "help", context: [] });
    expect(result.costUsd).toBe(0);
    expect(result.promptTokens).toBe(812);
    expect(result.completionTokens).toBe(96);
    expect(adapter.provider).toBe("subscription-bridge");
    expect(adapter.model).toBe("claude-fable-5");
    expect(adapter.lastDegraded).toBeNull();
  });

  it("falls through to the fallback adapter on rate limit and records the reason", async () => {
    const transport = stubTransport(async () => ({
      state: "failed",
      errorClass: "rate_limited",
      errorMessage: "5-hour limit reached · resets at 7:00 PM",
    }));
    const fallback = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      complete: vi.fn(async () => ({
        text: "fallback answer",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.001,
      })),
    };
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallback,
      sleep: noSleep,
    });
    const result = await adapter.complete({ message: "help", context: [] });
    expect(result.text).toBe("fallback answer");
    expect(adapter.lastDegraded).toBe("bridge-rate-limited");
    expect(adapter.model).toBe("claude-sonnet-4-20250514");
    expect(fallback.complete).toHaveBeenCalledOnce();
  });

  it("surfaces the provider's rate-limit reset text verbatim when there is no fallback", async () => {
    const transport = stubTransport(async () => ({
      state: "failed",
      errorClass: "rate_limited",
      errorMessage: "Your limit will reset at 7:00 PM (America/New_York).",
    }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      sleep: noSleep,
    });
    await expect(adapter.complete({ message: "help", context: [] })).rejects.toThrow(
      /reset at 7:00 PM \(America\/New_York\)/,
    );
  });

  it("gives up within the poll budget, abandons the queued job, and reports bridge-timeout", async () => {
    let clock = 0;
    const transport = stubTransport(async () => ({ state: "queued" }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      sleep: async () => {
        clock += 10_000;
      },
      now: () => clock,
      totalBudgetMs: 75_000,
    });
    const failure = await adapter.complete({ message: "help", context: [] }).catch((error) => error);
    expect(failure).toBeInstanceOf(SubscriptionBridgeError);
    expect((failure as SubscriptionBridgeError).degraded).toBe("bridge-timeout");
    expect(transport.abandoned).toEqual(["job-1"]);
  });

  it("falls through when the TRANSPORT itself fails (unset bridge URL, pool blip)", async () => {
    const transport: SubscriptionBridgeTransport = {
      enqueue: vi.fn(async () => {
        throw new Error("DATABASE_AI_BRIDGE_URL is not configured");
      }),
      poll: vi.fn(async () => ({ state: "queued" as const })),
      abandon: vi.fn(async () => {}),
    };
    const fallback = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      complete: vi.fn(async () => ({
        text: "chain answer",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.001,
      })),
    };
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallback,
      sleep: noSleep,
    });
    const result = await adapter.complete({ message: "help", context: [] });
    expect(result.text).toBe("chain answer");
    expect(adapter.lastDegraded).toBe("bridge-offline");
    expect(fallback.complete).toHaveBeenCalledOnce();
  });

  it("keeps the underlying transport error text when there is no fallback", async () => {
    const transport: SubscriptionBridgeTransport = {
      enqueue: vi.fn(async () => ({ jobId: "job-1" })),
      poll: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      abandon: vi.fn(async () => {}),
    };
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      sleep: noSleep,
    });
    const failure = await adapter.complete({ message: "help", context: [] }).catch((error) => error);
    expect(failure).toBeInstanceOf(SubscriptionBridgeError);
    expect((failure as SubscriptionBridgeError).errorClass).toBe("transport_error");
    expect((failure as Error).message).toContain("fetch failed");
  });

  it("reports the bridge before a turn and the real provider after a fall-through", async () => {
    const transport = stubTransport(async () => ({
      state: "failed",
      errorClass: "cli_error",
      errorMessage: "claude exited 1",
    }));
    const fallback = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      complete: vi.fn(async () => ({
        text: "chain answer",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.004,
      })),
    };
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallback,
      sleep: noSleep,
    });
    // Pre-call contract: meteredAI classifies key_source from this value.
    expect(adapter.provider).toBe("subscription-bridge");
    await adapter.complete({ message: "help", context: [] });
    // Post-fallback: the ledger must book the key that actually answered.
    expect(adapter.provider).toBe("anthropic");
  });

  it("resets the reported provider per turn when the bridge answers again", async () => {
    let bridgeUp = false;
    const transport = stubTransport(async () =>
      bridgeUp
        ? {
            state: "done" as const,
            result: { text: "bridged", model: "claude-fable-5", usage: {} },
          }
        : { state: "failed" as const, errorClass: "cli_error", errorMessage: "boom" },
    );
    const fallback = {
      provider: "openai",
      model: "gpt-4.1-mini",
      complete: async () => ({ text: "chain", promptTokens: 1, completionTokens: 1, costUsd: 0.1 }),
    };
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallback,
      sleep: noSleep,
    });
    await adapter.complete({ message: "one", context: [] });
    expect(adapter.provider).toBe("openai");
    bridgeUp = true;
    await adapter.complete({ message: "two", context: [] });
    expect(adapter.provider).toBe("subscription-bridge");
    expect(adapter.lastDegraded).toBeNull();
  });

  it("never resolves the lazy fallback chain when the bridge answers", async () => {
    const transport = stubTransport(async () => ({
      state: "done",
      result: { text: "bridged", model: "claude-fable-5", usage: {} },
    }));
    const fallbackFactory = vi.fn(async () => ({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      complete: async () => ({ text: "chain", promptTokens: 1, completionTokens: 1, costUsd: 0.1 }),
    }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallbackFactory,
      sleep: noSleep,
    });
    const result = await adapter.complete({ message: "help", context: [] });
    expect(result.text).toBe("bridged");
    expect(fallbackFactory).not.toHaveBeenCalled();
  });

  it("resolves the lazy fallback on failure and memoizes it across turns", async () => {
    const transport = stubTransport(async () => ({
      state: "failed",
      errorClass: "cli_error",
      errorMessage: "boom",
    }));
    const fallbackFactory = vi.fn(async () => ({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      complete: async () => ({ text: "chain", promptTokens: 1, completionTokens: 1, costUsd: 0.1 }),
    }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallbackFactory,
      sleep: noSleep,
    });
    expect((await adapter.complete({ message: "one", context: [] })).text).toBe("chain");
    expect((await adapter.complete({ message: "two", context: [] })).text).toBe("chain");
    expect(fallbackFactory).toHaveBeenCalledOnce();
    expect(adapter.model).toBe("claude-sonnet-4-20250514");
    expect(adapter.provider).toBe("anthropic");
  });

  it("treats a throwing fallback factory exactly like no fallback", async () => {
    const transport = stubTransport(async () => ({
      state: "failed",
      errorClass: "rate_limited",
      errorMessage: "Your limit will reset at 7:00 PM (America/New_York).",
    }));
    const adapter = new SubscriptionBridgeChatAdapter({
      transport,
      orgId: "org-1",
      feature: "chat",
      fallbackFactory: () => {
        throw new Error("No AI provider key is configured for this organization.");
      },
      sleep: noSleep,
    });
    await expect(adapter.complete({ message: "help", context: [] })).rejects.toThrow(
      /reset at 7:00 PM \(America\/New_York\)/,
    );
    expect(adapter.lastDegraded).toBe("bridge-rate-limited");
  });
});

/** Route-map fake client: answers by SQL shape, empty result for anything unscripted. */
function routedClient(routes: Array<{ match: RegExp; rows: unknown[] }>) {
  return {
    query: vi.fn(async (sql: string) => {
      const route = routes.find((entry) => entry.match.test(sql));
      return { rows: route?.rows ?? [], rowCount: route?.rows.length ?? 0 };
    }),
  };
}

const anthropicKeyRow = {
  id: "k1",
  provider: "anthropic",
  keyCiphertext: "c",
  keyNonce: "n",
  keyAuthTag: "t",
  encryptedDek: "d",
  kmsKeyId: "k",
};

describe("resolver fall-through order with a bridge", () => {
  const transport = stubTransport(async () => ({ state: "queued" }));

  it("tries an ONLINE preferred bridge FIRST for chat, wrapping the key chain as fallback", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true, version: "2.1.241", authenticated: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: transport,
      decrypt: async () => "sk-ant",
    });
    expect(resolved.adapter).toBeInstanceOf(SubscriptionBridgeChatAdapter);
    expect(resolved.provenance.source).toBe("subscription-bridge");
    expect(resolved.provenance.provider).toBe("subscription-bridge");
    expect(resolved.degraded).toBeUndefined();
  });

  it("skips a stale bridge, resolves the normal chain, and says degraded: bridge-offline", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            preferWhenOnline: true,
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: transport,
      decrypt: async () => "sk-ant",
    });
    expect(resolved.adapter).toBeInstanceOf(HttpChatAdapter);
    expect(resolved.degraded).toBe("bridge-offline");
  });

  it("keeps batch features (dreams) OFF the bridge under the default 'chat' coverage", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
            coverage: null, // pre-0488 rows and the default both mean 'chat'
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "dreams",
      bridgeTransport: transport,
      decrypt: async () => "sk-ant",
    });
    expect(resolved.adapter).toBeInstanceOf(HttpChatAdapter);
    // A chat-only device seeing a heavy feature is configuration, not degradation.
    expect(resolved.degraded).toBeUndefined();
  });

  /**
   * Reach guard: the ONLY thing keeping a batch feature off a default-coverage device
   * is the coverage gate. Widening the bridge's reach (dropping the gate, or defaulting
   * a NULL coverage to 'everything') would silently push team-wide batch work onto one
   * member's personal plan — this test is what fails first if that happens.
   */
  it("gates batch features on device coverage, not on whether the transport is present", async () => {
    const deviceRow = (coverage: string | null) => ({
      engines: { claude: { available: true } },
      lastHeartbeatAt: new Date().toISOString(),
      preferWhenOnline: true,
      coverage,
    });
    const chatOnly = routedClient([
      { match: /FROM ai_bridge_devices/, rows: [deviceRow(null)] },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const enqueueSpy = stubTransport(async () => ({ state: "queued" }));
    const gated = await resolveOrgChatAdapterWithProvenance(chatOnly as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "season_report",
      bridgeTransport: enqueueSpy,
      decrypt: async () => "sk-ant",
    });
    // The coverage gate is consulted (the device query runs) and then refuses the job:
    // nothing is ever enqueued onto the paired member's subscription.
    expect(
      chatOnly.query.mock.calls.some((call: unknown[]) => /FROM ai_bridge_devices/.test(call[0] as string)),
    ).toBe(true);
    expect(gated.adapter).toBeInstanceOf(HttpChatAdapter);
    expect(gated.provenance.source).not.toBe("subscription-bridge");
    expect(enqueueSpy.enqueue).not.toHaveBeenCalled();

    // Same device, same feature, coverage flipped: only then does the bridge serve it.
    const optedIn = routedClient([
      { match: /FROM ai_bridge_devices/, rows: [deviceRow("everything")] },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const allowed = await resolveOrgChatAdapterWithProvenance(optedIn as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "season_report",
      bridgeTransport: enqueueSpy,
      decrypt: async () => "sk-ant",
    });
    expect(allowed.adapter).toBeInstanceOf(SubscriptionBridgeChatAdapter);
  });

  it("resolves the key chain lazily: untouched while the bridge answers", async () => {
    const doneTransport = stubTransport(async () => ({
      state: "done",
      result: { text: "bridged", model: "claude-fable-5", usage: { inputTokens: 1, outputTokens: 1 } },
    }));
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const decrypt = vi.fn(async () => "sk-ant");
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: doneTransport,
      decrypt,
    });
    const chainQueries = () =>
      client.query.mock.calls.filter((call: unknown[]) => /FROM org_llm_keys/.test(call[0] as string)).length;
    expect(chainQueries()).toBe(0);
    const answer = await resolved.adapter.complete({ message: "hi", context: [] });
    expect(answer.text).toBe("bridged");
    expect(chainQueries()).toBe(0);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("resolves the key chain lazily: loaded and used the moment the bridge fails", async () => {
    const brokenTransport: SubscriptionBridgeTransport = {
      enqueue: vi.fn(async () => {
        throw new Error("DATABASE_AI_BRIDGE_URL is not configured");
      }),
      poll: vi.fn(async () => ({ state: "queued" as const })),
      abandon: vi.fn(async () => {}),
    };
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "chain answer" }],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: brokenTransport,
      decrypt: async () => "sk-ant",
      fetchImpl: fetchImpl as never,
    });
    const chainQueries = () =>
      client.query.mock.calls.filter((call: unknown[]) => /FROM org_llm_keys/.test(call[0] as string)).length;
    expect(chainQueries()).toBe(0);
    const answer = await resolved.adapter.complete({ message: "hi", context: [] });
    expect(answer.text).toBe("chain answer");
    expect(chainQueries()).toBe(1);
    // Provenance still says the bridge was chosen; the adapter reports who answered.
    expect(resolved.provenance.source).toBe("subscription-bridge");
    expect(resolved.adapter.provider).toBe("anthropic");
    expect((resolved.adapter as SubscriptionBridgeChatAdapter).lastDegraded).toBe("bridge-offline");
  });

  it("routes EVERY feature through the bridge when the device coverage is 'everything'", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true, authenticated: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
            coverage: "everything",
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    for (const feature of ["dreams", "season_report", "cad", "grants"]) {
      const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        feature,
        bridgeTransport: transport,
        decrypt: async () => "sk-ant",
      });
      expect(resolved.adapter, feature).toBeInstanceOf(SubscriptionBridgeChatAdapter);
      expect(resolved.provenance.source, feature).toBe("subscription-bridge");
    }
  });

  it("enqueues heavy jobs with the long CLI budget under 'everything' coverage", async () => {
    const doneTransport = stubTransport(async () => ({
      state: "done",
      result: { text: "report body", model: "claude-fable-5", usage: { inputTokens: 1, outputTokens: 1 } },
    }));
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: true,
            coverage: "everything",
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const heavy = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "season_report",
      bridgeTransport: doneTransport,
      decrypt: async () => "sk-ant",
    });
    await (heavy.adapter as SubscriptionBridgeChatAdapter).complete({ message: "go", context: [] });
    expect(doneTransport.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "season_report", timeoutMs: BRIDGE_HEAVY_CLI_TIMEOUT_MS }),
    );

    const interactive = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: doneTransport,
      decrypt: async () => "sk-ant",
    });
    await (interactive.adapter as SubscriptionBridgeChatAdapter).complete({ message: "hi", context: [] });
    expect(doneTransport.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "chat", timeoutMs: BRIDGE_INTERACTIVE_CLI_TIMEOUT_MS }),
    );
  });

  it("reports bridge-offline for a heavy feature when the 'everything' device is stale", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            preferWhenOnline: true,
            coverage: "everything",
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "dreams",
      bridgeTransport: transport,
      decrypt: async () => "sk-ant",
    });
    expect(resolved.adapter).toBeInstanceOf(HttpChatAdapter);
    expect(resolved.degraded).toBe("bridge-offline");
  });

  it("honors prefer_when_online = false: bridge exists, chain is used, no degradation claim", async () => {
    const client = routedClient([
      {
        match: /FROM ai_bridge_devices/,
        rows: [
          {
            engines: { claude: { available: true } },
            lastHeartbeatAt: new Date().toISOString(),
            preferWhenOnline: false,
          },
        ],
      },
      { match: /FROM org_llm_keys/, rows: [anthropicKeyRow] },
    ]);
    const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      bridgeTransport: transport,
      decrypt: async () => "sk-ant",
    });
    expect(resolved.adapter).toBeInstanceOf(HttpChatAdapter);
    expect(resolved.degraded).toBeUndefined();
  });
});
