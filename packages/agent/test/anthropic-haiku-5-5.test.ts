import { describe, expect, it, vi } from "vitest";
import { HttpChatAdapter, anthropicOutputSettings } from "../src/http-chat-adapter";

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
  it("asks for low effort and leaves room for thinking, only on Haiku 5.x", () => {
    expect(anthropicOutputSettings("claude-haiku-5-5", 1024)).toEqual({ max_tokens: 4096, output_config: { effort: "low" } });
    expect(anthropicOutputSettings("claude-haiku-5-5", 8000)).toEqual({ max_tokens: 8000, output_config: { effort: "low" } });
    expect(anthropicOutputSettings("claude-sonnet-5", 1024)).toEqual({ max_tokens: 1024 });
    expect(anthropicOutputSettings("claude-haiku-4-5", 1024)).toEqual({ max_tokens: 1024 });
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
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
    for (const key of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(key);
    expect(body.messages.at(-1).role).toBe("user");
  });
});
