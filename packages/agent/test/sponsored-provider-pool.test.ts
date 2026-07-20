import { describe, expect, it, vi } from "vitest";
import { ProviderRateLimitError } from "../src/http-chat-adapter";
import {
  SponsoredFailoverChatAdapter,
  isSponsoredRateLimitError,
  listConfiguredSponsoredProviders,
} from "../src/sponsored-provider-pool";

describe("sponsored provider pool", () => {
  it("orders configured providers Mistral → Groq → Cohere → Cerebras", () => {
    const list = listConfiguredSponsoredProviders({
      COHERE_API_KEY: "c",
      GROQ_API_KEY: "g",
      CEREBRAS_API_KEY: "z",
      MISTRAL_API_KEY: "m",
    } as NodeJS.ProcessEnv);
    expect(list.map((p) => p.id)).toEqual(["mistral", "groq", "cohere", "cerebras"]);
  });

  it("detects rate-limit and payment/quota errors", () => {
    expect(isSponsoredRateLimitError(new ProviderRateLimitError("rate limited", 429))).toBe(true);
    expect(isSponsoredRateLimitError(new ProviderRateLimitError("quota", 402))).toBe(true);
    expect(isSponsoredRateLimitError(new Error("OpenAI-compatible chat failed (402)"))).toBe(true);
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
          choices: [{ message: { content: "ok from groq" } }],
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
        GROQ_API_KEY: "groq-test",
      } as NodeJS.ProcessEnv,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok from groq");
    expect(adapter.provider).toBe("sponsored:groq");
    expect(calls).toBe(2);
  });

  it("skips 402 payment/quota like 429 and continues to the next provider", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mistral")) {
        seen.push("mistral");
        return new Response("rate limited", { status: 429 });
      }
      if (url.includes("groq")) {
        seen.push("groq");
        return new Response("Payment Required", { status: 402 });
      }
      if (url.includes("cohere")) {
        seen.push("cohere");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok from cohere after 402" } }],
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("cerebras")) {
        seen.push("cerebras");
        throw new Error("Cerebras should not be reached when Cohere succeeds");
      }
      throw new Error(`unexpected url ${url}`);
    });

    const adapter = new SponsoredFailoverChatAdapter({
      promptCachingEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        MISTRAL_API_KEY: "mistral-test",
        GROQ_API_KEY: "groq-test",
        COHERE_API_KEY: "cohere-test",
        CEREBRAS_API_KEY: "cerebras-test",
      } as NodeJS.ProcessEnv,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok from cohere after 402");
    expect(adapter.provider).toBe("sponsored:cohere");
    expect(seen).toEqual(["mistral", "groq", "cohere"]);
  });

  it("does not hard-fail the pool when Cerebras alone returns 402 (exhausted message)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Payment Required", { status: 402 }));

    const adapter = new SponsoredFailoverChatAdapter({
      promptCachingEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        CEREBRAS_API_KEY: "cerebras-test",
      } as NodeJS.ProcessEnv,
    });

    await expect(adapter.complete({ message: "hi", context: [] })).rejects.toThrow(
      /All sponsored promo providers are unavailable or rate-limited/,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
