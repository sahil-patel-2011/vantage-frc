import { describe, expect, it, vi } from "vitest";
import { HttpChatAdapter } from "../src/http-chat-adapter";
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

describe("resolveOrgChatAdapter", () => {
  it("prefers enabled HTTPS org provider configs (BYOK/custom)", async () => {
    const client = fakeClient([
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "p1",
            kind: "openai-compatible",
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
      decrypt: async () => "sk-ant",
    });

    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toContain("claude");
  });

  it("uses org_llm_keys Google Gemini via OpenAI-compatible endpoint", async () => {
    const client = fakeClient([
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
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "p1",
            kind: "openai-compatible",
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
      () => ({ rowCount: 1, rows: [{ tier: "free" }] }),
    ]);

    await expect(
      resolveOrgChatAdapter(client as never, {
        orgId: "org-1",
        promptCachingEnabled: false,
        decrypt: async () => "unused",
      }),
    ).rejects.toThrow(/OpenAI, Anthropic, or Google key under Team/);
  });
});
