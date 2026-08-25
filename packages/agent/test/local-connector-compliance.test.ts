import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpChatAdapter } from "../src/http-chat-adapter";
import {
  resolveOrgChatAdapterWithProvenance,
  type ResolvedOrgChatAdapter,
} from "../src/resolve-chat-adapter";
import { resolveOrgSttEndpoint } from "../src/resolve-stt-endpoint";
import { classifyModelTier, degradedNoticeCopy } from "../src/model-tier";

/**
 * Compliance matrix: a single local-connector config (OpenAI-compatible base
 * URL + any key + model mapping) must resolve a USABLE adapter for every
 * feature class the app routes through resolve-chat-adapter — chat, writer,
 * agent, and dream-class background runs — with provenance that says exactly
 * what answered (source='local-connector', origin only) and a tier classifier
 * that flags the localhost origin as small-or-local.
 *
 * This is the "any endpoint runs everything" guarantee from docs/LOCAL_AI.md.
 */

type QueryResult<T> = { rows: T[]; rowCount: number };

const LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const LOCAL_ORIGIN = "http://127.0.0.1:11434";
const LOCAL_MODEL = "qwen2.5:14b";

/** Query script for one full resolveOrgChatAdapterWithProvenance pass (no userId):
 *  1. routing prefs + policy, 2. org_provider_configs, 3. org_llm_keys. */
function localConnectorClient() {
  const handlers: Array<() => QueryResult<unknown>> = [
    () => ({ rowCount: 0, rows: [] }), // routing prefs + policy miss → automode defaults
    () => ({
      rowCount: 1,
      rows: [
        {
          id: "p-local",
          kind: "openai-compatible",
          label: "Local (Ollama / LM Studio)",
          baseUrl: LOCAL_BASE_URL,
          localRelay: false,
          modelMappings: { default: LOCAL_MODEL, stt: "whisper-1" },
          keyCiphertext: "c",
          keyNonce: "n",
          keyAuthTag: "t",
          encryptedDek: "d",
          kmsKeyId: "k",
        },
      ],
    }),
    () => ({ rowCount: 0, rows: [] }), // org_llm_keys: no cloud keys at all
  ];
  let index = 0;
  return {
    query: vi.fn(async (sql: string) => {
      const handler = handlers[index++];
      if (!handler) throw new Error(`Unexpected query: ${sql}`);
      return handler();
    }),
  };
}

const PLATFORM_ENV_KEYS = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY"] as const;

describe("local-connector compliance matrix", () => {
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

  // Every feature class the product resolves through resolve-chat-adapter.
  const FEATURE_MATRIX = ["chat", "writer", "agent", "team_dream_week", "cad", "code"] as const;

  for (const feature of FEATURE_MATRIX) {
    it(`resolves a usable local adapter for feature=${feature} with local-connector provenance`, async () => {
      const client = localConnectorClient();
      const resolved: ResolvedOrgChatAdapter = await resolveOrgChatAdapterWithProvenance(
        client as never,
        {
          orgId: "org-1",
          promptCachingEnabled: false,
          feature,
          decrypt: async () => "ollama", // any key — local servers ignore it
        },
      );

      expect(resolved.adapter).toBeInstanceOf(HttpChatAdapter);
      const adapter = resolved.adapter as HttpChatAdapter;
      expect(adapter.provider).toBe("openai-compatible");
      expect(adapter.model).toBe(LOCAL_MODEL);
      expect(adapter.baseUrl).toBe(LOCAL_BASE_URL);

      // Provenance: source says local-connector, origin only (never path or key).
      expect(resolved.provenance).toEqual({
        provider: "openai-compatible",
        modelId: LOCAL_MODEL,
        baseUrlOrigin: LOCAL_ORIGIN,
        source: "local-connector",
      });
      expect(resolved.provenance.baseUrlOrigin).not.toContain("/v1");
    });
  }

  it("the resolved local adapter actually completes a chat against the local endpoint", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(`${LOCAL_BASE_URL}/chat/completions`);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "local hello" } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const client = localConnectorClient();
    const { adapter } = await resolveOrgChatAdapterWithProvenance(client as never, {
      orgId: "org-1",
      promptCachingEnabled: false,
      feature: "chat",
      decrypt: async () => "ollama",
      fetchImpl: fetchImpl as never,
    });

    const result = await adapter.complete({ message: "hi", context: [] });
    expect(result.text).toBe("local hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifyModelTier flags the localhost origin as small-or-local and produces the honest notice", () => {
    const tier = classifyModelTier({
      provider: "openai-compatible",
      modelId: LOCAL_MODEL,
      baseUrlOrigin: LOCAL_ORIGIN,
    });
    expect(tier.tier).toBe("small-or-local");

    const notice = degradedNoticeCopy(tier.tier, LOCAL_MODEL);
    expect(notice).toContain(LOCAL_MODEL);
    expect(notice).toContain("smaller model");
  });

  it("even an unrecognized model name on a LAN origin is flagged small-or-local", () => {
    expect(
      classifyModelTier({
        provider: "openai-compatible",
        modelId: "workshop-finetune-v3",
        baseUrlOrigin: "http://192.168.1.42:1234",
      }).tier,
    ).toBe("small-or-local");
  });

  it("resolves STT through the same local connector (source=local-connector, mapped stt model)", async () => {
    // resolveOrgSttEndpoint (no userId): 1. org_llm_keys, 2. org_provider_configs.
    const handlers: Array<() => QueryResult<unknown>> = [
      () => ({ rowCount: 0, rows: [] }),
      () => ({
        rowCount: 1,
        rows: [
          {
            id: "p-local",
            kind: "openai-compatible",
            label: "Local (Ollama / LM Studio)",
            baseUrl: LOCAL_BASE_URL,
            modelMappings: { default: LOCAL_MODEL, stt: "faster-whisper-medium" },
            keyCiphertext: "c",
            keyNonce: "n",
            keyAuthTag: "t",
            encryptedDek: "d",
            kmsKeyId: "k",
          },
        ],
      }),
    ];
    let index = 0;
    const client = {
      query: vi.fn(async () => {
        const handler = handlers[index++];
        if (!handler) throw new Error("Unexpected query");
        return handler();
      }),
    };

    const endpoint = await resolveOrgSttEndpoint(client as never, {
      orgId: "org-1",
      decrypt: async () => "",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(endpoint).not.toBeNull();
    expect(endpoint!.provider).toBe("openai-compatible");
    expect(endpoint!.baseUrl).toBe(LOCAL_BASE_URL);
    expect(endpoint!.model).toBe("faster-whisper-medium");
    expect(endpoint!.source).toBe("local-connector");
    expect(endpoint!.baseUrlOrigin).toBe(LOCAL_ORIGIN);
  });
});
