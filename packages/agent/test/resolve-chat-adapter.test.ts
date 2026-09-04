import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpChatAdapter } from "../src/http-chat-adapter";
import { OrgIsolatedChatAdapter } from "../src/org-isolation";
import {
  ChatProviderResolutionError,
  resolveOrgChatAdapter,
} from "../src/resolve-chat-adapter";

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
  "FREE_RELAY_BASE_URL",
  "FREE_RELAY_API_KEY",
  "FREE_RELAY_MODEL",
] as const;

describe("resolveOrgChatAdapter", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of PLATFORM_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
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

  it("uses org_llm_keys Google Gemini via OpenAI-compatible endpoint", async () => {
    const client = fakeClient([
      () => ({ rowCount: 0, rows: [] }),
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "k-google",
            provider: "google",
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
      decrypt: async () => "AIza-test",
    });

    expect(adapter).toBeInstanceOf(HttpChatAdapter);
    expect(adapter.provider).toBe("openai-compatible");
    expect(adapter.model).toContain("gemini");
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
    ).rejects.toThrow(/OpenRouter free pool|Team → AI API keys/);
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

  it("uses isolated Freebuff when the org has a relay grant and the toggle is on, skipping BYOK", async () => {
    process.env.FREE_RELAY_BASE_URL = "http://127.0.0.1:8080/v1";
    process.env.FREE_RELAY_API_KEY = "relay-secret";
    const client = fakeClient([
      () => ({
        rowCount: 1,
        rows: [
          {
            prefs: {
              mode: "automode",
              use_platform_free_ai: true,
              freebuff_model: "mimo/mimo-2.5",
            },
            policy: null,
            hasRelayGrant: true,
          },
        ],
      }),
    ]);

    const adapter = await resolveOrgChatAdapter(client as never, {
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      promptCachingEnabled: false,
      decrypt: async () => {
        throw new Error("BYOK must not be decrypted when Free AI is preferred");
      },
    });

    expect(adapter).toBeInstanceOf(OrgIsolatedChatAdapter);
    expect(adapter.model).toBe("mimo/mimo-2.5");
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("uses team BYOK when the Free AI toggle is off even if a relay grant exists", async () => {
    process.env.FREE_RELAY_BASE_URL = "http://127.0.0.1:8080/v1";
    process.env.FREE_RELAY_API_KEY = "relay-secret";
    const client = fakeClient([
      () => ({
        rowCount: 1,
        rows: [
          {
            prefs: { mode: "automode", use_platform_free_ai: false },
            policy: null,
            hasRelayGrant: true,
          },
        ],
      }),
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
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "sk-ant-org",
    });

    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toContain("claude");
  });
});
