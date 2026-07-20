import { describe, expect, it, vi } from "vitest";
import { ProviderRateLimitError } from "../src/http-chat-adapter";
import {
  SponsoredFailoverChatAdapter,
  isSponsoredRateLimitError,
  listConfiguredSponsoredProviders,
} from "../src/sponsored-provider-pool";

describe("sponsored provider pool", () => {
  it("orders configured providers Mistral → Cerebras → Groq → Cohere", () => {
    const list = listConfiguredSponsoredProviders({
      COHERE_API_KEY: "c",
      GROQ_API_KEY: "g",
      CEREBRAS_API_KEY: "z",
      MISTRAL_API_KEY: "m",
    } as NodeJS.ProcessEnv);
    expect(list.map((p) => p.id)).toEqual(["mistral", "cerebras", "groq", "cohere"]);
  });

  it("detects rate-limit errors", () => {
    expect(isSponsoredRateLimitError(new ProviderRateLimitError("rate limited", 429))).toBe(true);
    expect(isSponsoredRateLimitError(new Error("OpenAI-compatible chat failed (500)"))).toBe(false);
  });

  it("fails over to the next provider on 429", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok from cerebras" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new SponsoredFailoverChatAdapter({
      promptCachingEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        MISTRAL_API_KEY: "mistral-test",
        CEREBRAS_API_KEY: "cerebras-test",
      } as NodeJS.ProcessEnv,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok from cerebras");
    expect(adapter.provider).toBe("sponsored:cerebras");
    expect(calls).toBe(2);
  });
});
