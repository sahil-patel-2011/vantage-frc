import { describe, expect, it, vi } from "vitest";
import {
  HttpChatAdapter,
  boundRecentThreadMessages,
  estimateAdapterCostUsd,
  planChatToolCalls,
} from "../src";

describe("bounded multi-turn chat history", () => {
  it("keeps recent role boundaries and cannot grow past count or token limits", () => {
    const turns = Array.from({ length: 40 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:${"x".repeat(80)}`,
    }));
    const bounded = boundRecentThreadMessages(turns, 220, 6);
    expect(bounded.messages).toHaveLength(6);
    expect(bounded.messages.map((turn) => turn.id)).toEqual([
      "m-34",
      "m-35",
      "m-36",
      "m-37",
      "m-38",
      "m-39",
    ]);
    expect(bounded.messages.map((turn) => turn.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(bounded.estimatedTokens).toBeLessThanOrEqual(220);
  });

  it("sends prior turns as provider messages and uses native OpenAI tool calls", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "reference.team", arguments: '{"teamKey":"frc254"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new HttpChatAdapter({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await adapter.complete({
      message: "What about team 254?",
      context: [],
      history: [
        { role: "user", content: "Compare our next opponents." },
        { role: "assistant", content: "Which team should I inspect?" },
      ],
      tools: [{ name: "reference.team", description: "Load a team", inputSchema: { type: "object" } }],
    });
    const body = bodies[0]!;
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.slice(-3).map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages.at(-1)?.content).toBe("What about team 254?");
    expect(body.tool_choice).toBe("auto");
    expect(result.toolCalls).toEqual([
      { name: "reference.team", input: { teamKey: "frc254" }, callId: "call-1" },
    ]);
  });
});

describe("tool fallback and preflight pricing", () => {
  it("retains deterministic tool planning when native calls are unavailable", () => {
    expect(planChatToolCalls("What did scouting see on team 254?")).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "scouting.team" })]),
    );
  });

  it("derives preflight cost from adapter token rates", () => {
    const adapter = new HttpChatAdapter({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "test-key",
      promptCachingEnabled: false,
      prices: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 },
    });
    expect(estimateAdapterCostUsd(adapter, 1_000, 500)).toBeCloseTo(0.006);
  });
});
