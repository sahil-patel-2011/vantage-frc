import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpChatAdapter } from "../src/http-chat-adapter";
import { ModelFallbackChatAdapter } from "../src/model-fallback-adapter";
import {
  ChatProviderResolutionError,
  GOOGLE_TURN_INPUT_RESERVE,
  orderGoogleModels,
  resolveOrgChatAdapter,
} from "../src/resolve-chat-adapter";
import { GOOGLE_FREE_TIER_INPUT_TPM } from "../src/byok-model-routing";
import { CLOUD_CONTEXT_TOKEN_BUDGET, contextTokenBudgetForAdapter } from "../src/context-compact";

type QueryResult<T> = { rows: T[]; rowCount: number };

function fakeClient(handlers: Array<(sql: string, params?: unknown[]) => QueryResult<unknown> | Promise<QueryResult<unknown>>>) {
  let index = 0;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const handler = handlers[index++];
      if (!handler) throw new Error(`Unexpected query: ${sql}`);
      return handler(sql, params);
    }),
  };
}

const PLATFORM_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "PETALS_PUBLIC_POOL",
] as const;

describe("resolveOrgChatAdapter", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of PLATFORM_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PETALS_PUBLIC_POOL = "0";
  });

  afterEach(() => {
    for (const key of PLATFORM_ENV_KEYS) {
      const previous = savedEnv[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("prefers enabled HTTPS org provider configs (BYOK/custom)", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }), // routing prefs miss
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "p1",
            kind: "openai-compatible",
            label: "Custom",
            baseUrl: "https://api.example.com/v1",
            localRelay: false,
            modelMappings: { default: "team-model" },
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
      () => ({ rowCount: 0, rows: [] }), // org_llm_keys
      () => ({ rowCount: 0, rows: [] }), // catalog prices miss → defaults
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: true,
      decrypt: async () => "sk-test",
    });

    expect(adapter).toBeInstanceOf(HttpChatAdapter);
    expect(adapter.provider).toBe("openai-compatible");
    expect(adapter.model).toBe("team-model");
  });

  it("uses org_llm_keys OpenAI/Anthropic when no hosted custom provider exists", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "k1",
            provider: "anthropic",
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
      () => ({ rowCount: 0, rows: [] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "sk-ant",
    });

    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toContain("claude");
  });

  const googleKeyRow = (id: string) => ({
    id,
    provider: "google",
    keyCiphertext: id,
    keyNonce: "n",
    keyAuthTag: "t",
    encryptedDek: "d",
    kmsKeyId: "k",
  });
  const empty = () => ({ rowCount: 0, rows: [] });
  /** A fake Gemini endpoint: `answer(model, key)` returns an HTTP status, 200 = "ok". */
  function geminiFetch(answer: (model: string, key: string) => number) {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      const key = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
      asked.push(`${key}/${model}`);
      const status = answer(model, key);
      if (status !== 200) return new Response("no", { status });
      return Response.json({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 7, completion_tokens: 1 },
      });
    }) as unknown as typeof fetch;
    return { asked, fetchImpl };
  }

  it("routes a Google key to free-tier models: Flash-Lite for light asks, Flash for hard ones", async () => {
    const resolve = (feature: string) =>
      resolveOrgChatAdapter(
        fakeClient([empty, empty, () => ({ rowCount: 1, rows: [googleKeyRow("team")] }), empty]) as never,
        { orgId: "org-1", promptCachingEnabled: false, feature, decrypt: async () => "AQ.team" },
      );
    const chat = await resolve("chat");
    expect(chat).toBeInstanceOf(ModelFallbackChatAdapter);
    expect(chat.provider).toBe("openai-compatible");
    expect(chat.model).toBe("gemini-3.5-flash-lite");
    expect((await resolve("strategy")).model).toBe("gemini-3.8-flash");
    // CAD asks for the strongest model; Pro has no free tier, so Automode stops at Flash.
    expect((await resolve("cad")).model).toBe("gemini-3.8-flash");
  });

  it("answers on the other free model when one is overloaded or out of quota", async () => {
    for (const status of [429, 503]) {
      const { asked, fetchImpl } = geminiFetch((model) => (model === "gemini-3.8-flash" ? status : 200));
      const adapter = await resolveOrgChatAdapter(
        fakeClient([empty, empty, () => ({ rowCount: 1, rows: [googleKeyRow("team")] })]) as never,
        { orgId: "org-1", promptCachingEnabled: false, feature: "cad", decrypt: async () => "AQ.team", fetchImpl },
      );
      const result = await adapter.complete({ message: "hi", context: [] });
      expect(result.text).toBe("ok");
      expect(asked).toEqual(["AQ.team/gemini-3.8-flash", "AQ.team/gemini-3.5-flash-lite"]);
      expect(adapter.model).toBe("gemini-3.5-flash-lite");
    }
  });

  it("sends the turn to the model with room when the ledger shows the other is full this minute", async () => {
    const { asked, fetchImpl } = geminiFetch(() => 200);
    const adapter = await resolveOrgChatAdapter(
      fakeClient([
        empty,
        empty,
        () => ({ rowCount: 1, rows: [googleKeyRow("team")] }),
        // 240k of the 250k free input tokens for Flash already used in the last minute.
        () => ({ rowCount: 1, rows: [{ model: "gemini-3.8-flash", team: "240000", mine: "0" }] }),
      ]) as never,
      { orgId: "org-1", promptCachingEnabled: false, feature: "cad", decrypt: async () => "AQ.team", fetchImpl },
    );
    expect(adapter.model).toBe("gemini-3.5-flash-lite");
    await adapter.complete({ message: "hi", context: [] });
    expect(asked).toEqual(["AQ.team/gemini-3.5-flash-lite"]);
  });

  it("uses a member's own Google key first and the team key only when theirs is spent", async () => {
    const { asked, fetchImpl } = geminiFetch((_model, key) => (key === "AQ.mine" ? 429 : 200));
    const adapter = await resolveOrgChatAdapter(
      fakeClient([
        empty, // routing prefs + policy
        () => ({ rowCount: 1, rows: [googleKeyRow("mine")] }), // member_llm_keys
        empty, // org_provider_configs
        () => ({ rowCount: 1, rows: [googleKeyRow("team")] }), // org_llm_keys
      ]) as never,
      {
        orgId: "org-1",
        userId: "user-1",
        promptCachingEnabled: false,
        feature: "chat",
        decrypt: async (parts) => `AQ.${parts.ciphertext}`,
        fetchImpl,
      },
    );
    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("ok");
    expect(asked).toEqual([
      "AQ.mine/gemini-3.5-flash-lite",
      "AQ.mine/gemini-3.8-flash",
      "AQ.team/gemini-3.5-flash-lite",
    ]);
  });

  it("only reaches Gemini Pro when the team fixed it, and still steps down on a free key", async () => {
    const { asked, fetchImpl } = geminiFetch((model) => (model.includes("pro") ? 429 : 200));
    const adapter = await resolveOrgChatAdapter(
      fakeClient([
        () => ({
          rowCount: 1,
          rows: [{ prefs: { mode: "fixed", fixed_model_id: "google:gemini-2.5-pro" }, policy: null }],
        }),
        empty,
        () => ({ rowCount: 1, rows: [googleKeyRow("team")] }),
      ]) as never,
      { orgId: "org-1", promptCachingEnabled: false, feature: "chat", decrypt: async () => "AQ.team", fetchImpl },
    );
    expect(adapter.model).toBe("gemini-3.1-pro-preview");
    await adapter.complete({ message: "hi", context: [] });
    expect(asked).toEqual(["AQ.team/gemini-3.1-pro-preview", "AQ.team/gemini-3.8-flash"]);
  });

  it("says what to do when every free model is out of quota", async () => {
    const { fetchImpl } = geminiFetch(() => 429);
    const adapter = await resolveOrgChatAdapter(
      fakeClient([empty, empty, () => ({ rowCount: 1, rows: [googleKeyRow("team")] })]) as never,
      { orgId: "org-1", promptCachingEnabled: false, feature: "chat", decrypt: async () => "AQ.team", fetchImpl },
    );
    await expect(adapter.complete({ message: "hi", context: [] })).rejects.toThrow(/Wait a minute and ask again/);
  });

  it("does not try another model when Google rejects the key", async () => {
    const { asked, fetchImpl } = geminiFetch(() => 403);
    const adapter = await resolveOrgChatAdapter(
      fakeClient([empty, empty, () => ({ rowCount: 1, rows: [googleKeyRow("team")] })]) as never,
      { orgId: "org-1", promptCachingEnabled: false, feature: "chat", decrypt: async () => "AQ.revoked", fetchImpl },
    );
    await expect(adapter.complete({ message: "hi", context: [] })).rejects.toThrow(/key was rejected/);
    expect(asked).toHaveLength(1);
  });

  it("keeps a full minute of turns inside the free-tier input limit", () => {
    // The reserve must cover one turn's input, and ten turns a minute must fit under the limit.
    expect(contextTokenBudgetForAdapter({ provider: "openai-compatible", model: "gemini-3.8-flash" })).toBe(
      CLOUD_CONTEXT_TOKEN_BUDGET,
    );
    expect(CLOUD_CONTEXT_TOKEN_BUDGET).toBeLessThan(GOOGLE_TURN_INPUT_RESERVE);
    expect(GOOGLE_TURN_INPUT_RESERVE * 10).toBeLessThan(GOOGLE_FREE_TIER_INPUT_TPM);
    const flash = { model: "gemini-3.8-flash", prices: { inputPerMillionUsd: 0.75, outputPerMillionUsd: 3.75 } };
    expect(orderGoogleModels(flash, () => 0).map((entry) => entry.model)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
    ]);
    expect(
      orderGoogleModels(flash, (model) => (model === "gemini-3.8-flash" ? 231_000 : 0)).map((entry) => entry.model),
    ).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  });

  it("falls through to managed peek for paid orgs", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "team" }] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            provider: "openai",
            model: "gpt-4.1-mini",
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
            keyId: "pk1",
            inputPrice: "1",
            outputPrice: "2",
            cacheReadPrice: "0.1",
            cacheWritePrice: "1.25",
          },
        ],
      }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: true,
      decrypt: async () => "sk-platform",
    });

    expect(adapter.provider).toBe("openai");
    expect(adapter.model).toBe("gpt-4.1-mini");
  });

  it("errors honestly when free org has only a local relay", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "p1",
            kind: "openai-compatible",
            label: "Relay",
            baseUrl: null,
            localRelay: true,
            modelMappings: { default: "local-model" },
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
    ]);

    await expect(
      resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        decrypt: async () => "unused",
      }),
    ).rejects.toMatchObject({
      name: "ChatProviderResolutionError",
      message: expect.stringContaining("local desktop relay"),
    } satisfies Partial<ChatProviderResolutionError> & { message: unknown });
  });

  it("errors honestly when no key exists", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
      () => ({ rowCount: 1, rows: [{ teamNumber: 254 }] }), // sponsored promo N/A
    ]);

    await expect(
      resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        decrypt: async () => "unused",
      }),
    ).rejects.toThrow(/OpenRouter free pool|Petals volunteer swarm|Team → AI API keys/);
  });

  it("uses sponsored failover pool for team 1111 within promo window", async () => {
    const prev = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = "mistral-test-key";
    try {
      const client = fakeClient([
        () => ({ rowCount: 0, rows: [] }),
        () => ({ rowCount: 0, rows: [] }),
        () => ({ rowCount: 0, rows: [] }),
        () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
        () => ({ rowCount: 1, rows: [{ teamNumber: 1111 }] }),
      ]);

      const adapter = await resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        decrypt: async () => "unused",
      });

      expect(adapter.provider.startsWith("sponsored")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MISTRAL_API_KEY;
      else process.env.MISTRAL_API_KEY = prev;
    }
  });

  it("surfaces promo-expired message for team 1111 after the window", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
      () => ({ rowCount: 1, rows: [{ teamNumber: 1111 }] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [] }),
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    try {
      await expect(
        resolveOrgChatAdapter(client as never, {
          orgId: "org-1",
          promptCachingEnabled: false,
          decrypt: async () => "unused",
        }),
      ).rejects.toThrow(/Promotional sponsored AI for team 1111 ended/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses platform OpenRouter for free orgs when OPENROUTER_API_KEY is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      decrypt: async () => "unused",
    });

    expect(adapter).toBeInstanceOf(HttpChatAdapter);
    expect(adapter.provider).toBe("openai-compatible");
    expect(adapter.model).toBe("openrouter/free");
  });

  it("refuses rather than reaching for the public swarm a team never enabled", async () => {
    delete process.env.PETALS_PUBLIC_POOL;
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
      () => ({ rowCount: 1, rows: [{ teamNumber: 254 }] }),
    ]);

    // Volunteer peers can read and rewrite what passes through the swarm, so a
    // free org with no key gets an honest "configure a provider", not a silent
    // hop onto strangers' GPUs.
    await expect(
      resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        decrypt: async () => "unused",
      }),
    ).rejects.toThrow(/No AI provider key is configured/);
  });

  it("uses the Petals public swarm when a free org has no keys and turned it on", async () => {
    process.env.PETALS_PUBLIC_POOL = "1";
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
      () => ({ rowCount: 1, rows: [{ teamNumber: 254 }] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      decrypt: async () => "unused",
    });

    expect(adapter.provider).toBe("petals");
    expect(adapter.model).toBe("petals-team/StableBeluga2");
  });

  it("uses hosted Anthropic Sonnet for paid orgs when managed peek is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-hosted";
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "team" }] }),
      () => ({ rowCount: 0, rows: [] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "unused",
    });

    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toBe("claude-sonnet-4-20250514");
  });

  it("uses hosted Anthropic Opus for paid CAD/code features", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-hosted";
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 1, rows: [{ tier: "team" }] }),
      () => ({ rowCount: 0, rows: [] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "cad",
      decrypt: async () => "unused",
    });

    expect(adapter.model).toBe("claude-opus-4-20250514");
  });

  it("prefers org BYOK over platform OpenRouter and Anthropic keys", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-platform";
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform";
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "k1",
            provider: "anthropic",
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
      () => ({ rowCount: 0, rows: [] }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "sk-ant-org",
    });

    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toContain("claude");
  });

  it("preferPlatform skips org BYOK and uses hosted Anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform";
    const client = fakeClient([]);
    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "bugbot_ultra",
      preferPlatform: true,
      decrypt: async () => "unused",
    });
    expect(adapter.provider).toBe("anthropic");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("preferPlatform fails honestly when no hosted key exists", async () => {
    const client = fakeClient([
      () => ({ rowCount: 1, rows: [{ tier: "team" }] }),
      () => ({ rowCount: 0, rows: [] }),
    ]);
    await expect(
      resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        preferPlatform: true,
        decrypt: async () => "unused",
      }),
    ).rejects.toBeInstanceOf(ChatProviderResolutionError);
  });

  it("personal OpenAI base URL overlays the team key when userId is set", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "m1",
            provider: "openai",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "llama3.2",
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "k1",
            provider: "openai",
            baseUrl: null,
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "org-1",
      userId: "user-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "local",
    });

    expect(adapter).toBeInstanceOf(HttpChatAdapter);
    expect(adapter.provider).toBe("openai-compatible");
    expect(adapter.model).toBe("llama3.2");
    expect((adapter as HttpChatAdapter).baseUrl).toBe("http://127.0.0.1:11434/v1");
  });
});
