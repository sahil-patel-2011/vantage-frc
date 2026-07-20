import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRateLimitError } from "../src/http-chat-adapter";
import {
  SponsoredFailoverChatAdapter,
  SPONSORED_PROVIDER_WEIGHTS,
  isSponsoredRateLimitError,
  listConfiguredSponsoredProviders,
  orderSponsoredProvidersWeightedRoundRobin,
  resetSponsoredRotationCursor,
} from "../src/sponsored-provider-pool";

const allKeysEnv = {
  MISTRAL_API_KEY: "mistral-test",
  GROQ_API_KEY: "groq-test",
  COHERE_API_KEY: "cohere-test",
  CEREBRAS_API_KEY: "cerebras-test",
} as NodeJS.ProcessEnv;

function okJson(text: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("sponsored provider pool", () => {
  afterEach(() => {
    resetSponsoredRotationCursor(0);
  });

  it("lists configured providers in catalog order (weights applied at request time)", () => {
    const list = listConfiguredSponsoredProviders({
      COHERE_API_KEY: "c",
      GROQ_API_KEY: "g",
      CEREBRAS_API_KEY: "z",
      MISTRAL_API_KEY: "m",
    } as NodeJS.ProcessEnv);
    expect(list.map((p) => p.id)).toEqual(["mistral", "groq", "cohere", "cerebras"]);
    expect(SPONSORED_PROVIDER_WEIGHTS).toEqual({
      mistral: 2,
      groq: 1,
      cohere: 1,
      cerebras: 1,
    });
  });

  it("weighted round-robin prefers Mistral ~2× without always starting there", () => {
    const configured = listConfiguredSponsoredProviders(allKeysEnv);
    // Wheel: [mistral, mistral, groq, cohere, cerebras] → length 5
    expect(orderSponsoredProvidersWeightedRoundRobin(configured, 0).map((p) => p.id)[0]).toBe(
      "mistral",
    );
    expect(orderSponsoredProvidersWeightedRoundRobin(configured, 1).map((p) => p.id)[0]).toBe(
      "mistral",
    );
    expect(orderSponsoredProvidersWeightedRoundRobin(configured, 2).map((p) => p.id)[0]).toBe(
      "groq",
    );
    expect(orderSponsoredProvidersWeightedRoundRobin(configured, 3).map((p) => p.id)[0]).toBe(
      "cohere",
    );
    expect(orderSponsoredProvidersWeightedRoundRobin(configured, 4).map((p) => p.id)[0]).toBe(
      "cerebras",
    );

    const firsts = Array.from({ length: 100 }, (_, i) =>
      orderSponsoredProvidersWeightedRoundRobin(configured, i)[0]!.id,
    );
    const counts = {
      mistral: firsts.filter((id) => id === "mistral").length,
      groq: firsts.filter((id) => id === "groq").length,
      cohere: firsts.filter((id) => id === "cohere").length,
      cerebras: firsts.filter((id) => id === "cerebras").length,
    };
    expect(counts).toEqual({ mistral: 40, groq: 20, cohere: 20, cerebras: 20 });
  });

  it("detects rate-limit and payment/quota errors", () => {
    expect(isSponsoredRateLimitError(new ProviderRateLimitError("rate limited", 429))).toBe(true);
    expect(isSponsoredRateLimitError(new ProviderRateLimitError("quota", 402))).toBe(true);
    expect(isSponsoredRateLimitError(new Error("OpenAI-compatible chat failed (402)"))).toBe(true);
    expect(isSponsoredRateLimitError(new Error("OpenAI-compatible chat failed (500)"))).toBe(false);
  });

  it("fails over to the next provider on 429 without retrying the failed one", async () => {
    resetSponsoredRotationCursor(0); // start on Mistral
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mistral")) {
        seen.push("mistral");
        return new Response("rate limited", { status: 429 });
      }
      if (url.includes("groq")) {
        seen.push("groq");
        return okJson("ok from groq");
      }
      throw new Error(`unexpected url ${url}`);
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
    expect(seen).toEqual(["mistral", "groq"]);
    expect(seen.filter((id) => id === "mistral")).toHaveLength(1);
  });

  it("skips 402 payment/quota like 429 and continues through the RR attempt chain", async () => {
    resetSponsoredRotationCursor(0); // mistral → groq → cohere → cerebras
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
        return okJson("ok from cohere after 402");
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
      env: allKeysEnv,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok from cohere after 402");
    expect(adapter.provider).toBe("sponsored:cohere");
    expect(seen).toEqual(["mistral", "groq", "cohere"]);
  });

  it("starts failover from a non-Mistral primary when the RR cursor lands there", async () => {
    resetSponsoredRotationCursor(2); // wheel index 2 → groq first
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("groq")) {
        seen.push("groq");
        return new Response("Payment Required", { status: 402 });
      }
      if (url.includes("cohere")) {
        seen.push("cohere");
        return okJson("ok from cohere");
      }
      if (url.includes("mistral") || url.includes("cerebras")) {
        seen.push(url.includes("mistral") ? "mistral" : "cerebras");
        throw new Error("should not reach further providers");
      }
      throw new Error(`unexpected url ${url}`);
    });

    const adapter = new SponsoredFailoverChatAdapter({
      promptCachingEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: allKeysEnv,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok from cohere");
    expect(adapter.provider).toBe("sponsored:cohere");
    expect(seen).toEqual(["groq", "cohere"]);
  });

  it("spreads successful first attempts across providers (Mistral weighted higher)", async () => {
    resetSponsoredRotationCursor(0);
    const firstProviders: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const id = url.includes("mistral")
        ? "mistral"
        : url.includes("groq")
          ? "groq"
          : url.includes("cohere")
            ? "cohere"
            : url.includes("cerebras")
              ? "cerebras"
              : "unknown";
      firstProviders.push(id);
      return okJson(`ok from ${id}`);
    });

    const adapter = new SponsoredFailoverChatAdapter({
      promptCachingEnabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: allKeysEnv,
    });

    for (let i = 0; i < 20; i++) {
      await adapter.complete({ message: "hi", context: [] });
    }

    const counts = {
      mistral: firstProviders.filter((id) => id === "mistral").length,
      groq: firstProviders.filter((id) => id === "groq").length,
      cohere: firstProviders.filter((id) => id === "cohere").length,
      cerebras: firstProviders.filter((id) => id === "cerebras").length,
    };
    // 20 requests / wheel 5 → 4 full cycles → mistral 8, others 4 each
    expect(counts).toEqual({ mistral: 8, groq: 4, cohere: 4, cerebras: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(20);
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
