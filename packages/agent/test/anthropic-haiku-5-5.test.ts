import { describe, expect, it, vi } from "vitest";
import {
  HAIKU_5_LONG_PROMPT_TOKENS,
  HttpChatAdapter,
  anthropicOutputSettings,
  pricesForPrompt,
} from "../src/http-chat-adapter";
import {
  AGENT_CHAT_HISTORY,
  AGENT_CONTEXT_TOKEN_BUDGET,
  chatHistoryBudgetForAdapter,
  CLOUD_CHAT_HISTORY,
  CLOUD_CONTEXT_TOKEN_BUDGET,
  contextTokenBudgetForAdapter,
  GEMINI_CONTEXT_TOKEN_BUDGET,
  SHORT_CHAT_HISTORY,
} from "../src/context-compact";
import { pickByokModelForFeature } from "../src/byok-model-routing";
import { anthropicHistoryWithCache } from "../src/prompt-caching";

function anthropicReply() {
  return new Response(
    JSON.stringify({
      // Claude Haiku 5.5 can open with a thinking block (empty text by default) before the answer.
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Team 254 is the strongest pick." },
      ],
      usage: { input_tokens: 40, output_tokens: 12 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Claude Haiku 5.5 requests", () => {
  it("sends medium effort by default, the team's pick otherwise, with room for thinking, only on Haiku 5.x", () => {
    expect(anthropicOutputSettings("claude-haiku-5-5", 1024)).toEqual({ max_tokens: 8192, output_config: { effort: "medium" } });
    expect(anthropicOutputSettings("claude-haiku-5-5", 1024, "low")).toEqual({ max_tokens: 4096, output_config: { effort: "low" } });
    expect(anthropicOutputSettings("claude-haiku-5-5", 1024, "high")).toEqual({ max_tokens: 16000, output_config: { effort: "high" } });
    expect(anthropicOutputSettings("claude-haiku-5-5", 20000, "low")).toEqual({ max_tokens: 20000, output_config: { effort: "low" } });
    expect(anthropicOutputSettings("claude-sonnet-5", 1024, "high")).toEqual({ max_tokens: 1024 });
    expect(anthropicOutputSettings("claude-haiku-4-5", 1024)).toEqual({ max_tokens: 1024 });
  });

  it("offers Low / Medium / High as Fixed choices; Automode stays on Medium", () => {
    const pick = (fixedModelId: string) =>
      pickByokModelForFeature({ feature: "chat", mode: "fixed", fixedModelId, availableProviders: ["anthropic"] });
    expect(pick("anthropic:claude-haiku-5-5")?.effort).toBe("medium");
    expect(pick("anthropic:claude-haiku-5-5@low")).toMatchObject({ modelId: "claude-haiku-5-5", effort: "low" });
    expect(pick("anthropic:claude-haiku-5-5@high")).toMatchObject({ modelId: "claude-haiku-5-5", effort: "high" });
    const auto = pickByokModelForFeature({ feature: "chat", mode: "automode", availableProviders: ["anthropic"] });
    expect(auto?.id).toBe("anthropic:claude-haiku-5-5");
  });

  it("caches the conversation so far, and leaves it alone with caching off or no history", () => {
    const history = [
      { role: "user" as const, content: "Who is strong at defense?" },
      { role: "assistant" as const, content: "Team 1678 and 254." },
    ];
    expect(anthropicHistoryWithCache(history, true)).toEqual([
      history[0],
      { role: "assistant", content: [{ type: "text", text: "Team 1678 and 254.", cache_control: { type: "ephemeral" } }] },
    ]);
    expect(anthropicHistoryWithCache(history, false)).toEqual(history);
    expect(anthropicHistoryWithCache([], true)).toEqual([]);
  });

  it("sends no sampling parameters or prefill, and reads the answer past a thinking block", async () => {
    const fetchImpl = vi.fn(async () => anthropicReply());
    const adapter = new HttpChatAdapter({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      apiKey: "test-key",
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.complete({ message: "Who should we pick?", context: [], history: [] });
    expect(result.text).toBe("Team 254 is the strongest pick.");
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);
    for (const key of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(key);
    expect(body.messages.at(-1).role).toBe("user");
  });
});

describe("Claude Haiku 5.5 long-prompt rate", () => {
  const prices = { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5, cacheReadPerMillionUsd: 0.01, cacheWritePerMillionUsd: 0.125 };

  it("bills a prompt over 100K tokens at five times the list rate", () => {
    expect(pricesForPrompt("claude-haiku-5-5", prices, HAIKU_5_LONG_PROMPT_TOKENS)).toBe(prices);
    expect(pricesForPrompt("claude-haiku-5-5", prices, HAIKU_5_LONG_PROMPT_TOKENS + 1)).toEqual({
      inputPerMillionUsd: 0.5,
      outputPerMillionUsd: 2.5,
      cacheReadPerMillionUsd: 0.05,
      cacheWritePerMillionUsd: 0.625,
    });
  });

  it("leaves other models on their one rate card", () => {
    expect(pricesForPrompt("claude-sonnet-4-20250514", prices, 500_000)).toBe(prices);
  });
});

describe("agent budgets", () => {
  const haiku = { provider: "anthropic", model: "claude-haiku-5-5" };

  it("gives agents more context and history than a chat turn", () => {
    expect(contextTokenBudgetForAdapter(haiku, "chat")).toBe(CLOUD_CONTEXT_TOKEN_BUDGET);
    expect(contextTokenBudgetForAdapter(haiku, "agent")).toBe(AGENT_CONTEXT_TOKEN_BUDGET);
    expect(contextTokenBudgetForAdapter(haiku, "cad.design")).toBe(AGENT_CONTEXT_TOKEN_BUDGET);
    expect(chatHistoryBudgetForAdapter(haiku, "coding")).toBe(AGENT_CHAT_HISTORY);
    expect(chatHistoryBudgetForAdapter(haiku, "chat")).toBe(CLOUD_CHAT_HISTORY);
  });

  it("keeps local models and Gemini's free tier on the short window, agents included", () => {
    expect(contextTokenBudgetForAdapter({ provider: "openai-compatible", model: "gemini-3.8-flash" }, "agent")).toBe(
      GEMINI_CONTEXT_TOKEN_BUDGET,
    );
    expect(chatHistoryBudgetForAdapter({ provider: "ollama", model: "llama3.2" }, "agent")).toBe(SHORT_CHAT_HISTORY);
  });
});
