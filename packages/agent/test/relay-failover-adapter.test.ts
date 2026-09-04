import { describe, expect, it } from "vitest";
import { ChatUpstreamTimeoutError } from "../src/chat-timeout";
import { ProviderRateLimitError } from "../src/http-chat-adapter";
import {
  RelayFailoverChatAdapter,
  isRelayFailoverWorthy,
  isRelayUnreachableError,
  resetRelayRotateCursor,
  tryCreatePlatformRelayAdapter,
} from "../src/relay-failover-adapter";
import type { ChatAdapter, ChatCompletionResult, ContextItem } from "../src/index";

/** Node/undici shape for a refused socket: TypeError with a coded cause. */
function connectionRefused(): Error {
  const error = new TypeError("fetch failed");
  (error as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return error;
}

class FakeAdapter implements ChatAdapter {
  readonly supportsNativeTools = true;
  calls: Array<{ message: string; context: ContextItem[]; toolCount: number }> = [];

  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly behavior: () => void = () => {},
  ) {}

  estimateCostUsd(): number {
    return 0;
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    tools?: unknown[];
  }): Promise<ChatCompletionResult> {
    this.calls.push({
      message: input.message,
      context: input.context,
      toolCount: input.tools?.length ?? 0,
    });
    this.behavior();
    return {
      text: `served by ${this.provider}`,
      promptTokens: 2,
      completionTokens: 1,
      costUsd: 0,
    };
  }
}

function thrower(error: Error): () => void {
  return () => {
    throw error;
  };
}

describe("relay failover classification", () => {
  it("treats a refused socket on the Pi as unreachable", () => {
    expect(isRelayUnreachableError(connectionRefused())).toBe(true);
  });

  it("treats an upstream timeout as unreachable", () => {
    expect(isRelayUnreachableError(new ChatUpstreamTimeoutError(30_000))).toBe(true);
  });

  it("treats DNS failure of a dead tunnel hostname as unreachable", () => {
    const error = new TypeError("fetch failed");
    (error as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo"), {
      code: "ENOTFOUND",
    });
    expect(isRelayUnreachableError(error)).toBe(true);
  });

  it("does not treat an ordinary bad request as unreachable", () => {
    expect(isRelayUnreachableError(new Error("freebuff chat failed (400)"))).toBe(false);
  });

  it("fails over on a spent daily pool", () => {
    expect(isRelayFailoverWorthy(new ProviderRateLimitError("rate-limited", 429))).toBe(true);
  });

  it("fails over when FreeBuff stops accepting the proxy as its CLI", () => {
    expect(isRelayFailoverWorthy(new Error("freebuff chat failed (403 free_mode_cli_required)"))).toBe(
      true,
    );
  });

  it("does not fail over on a malformed request, which every upstream would reject", () => {
    expect(isRelayFailoverWorthy(new Error("freebuff chat failed (400) model=deepseek"))).toBe(false);
  });
});

describe("RelayFailoverChatAdapter", () => {
  it("serves from the relay when the Pi is awake", async () => {
    const relay = new FakeAdapter("openai-compatible", "deepseek/deepseek-v4-flash");
    const backup = new FakeAdapter("openai-compatible", "openrouter-free");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    const result = await chain.complete({ message: "hi", context: [] });

    expect(result.text).toBe("served by openai-compatible");
    expect(relay.calls).toHaveLength(1);
    expect(backup.calls).toHaveLength(0);
    expect(chain.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("degrades to the next pool when the Pi is asleep, and reports the real upstream", async () => {
    const relay = new FakeAdapter("freebuff", "deepseek/deepseek-v4-flash", thrower(connectionRefused()));
    const backup = new FakeAdapter("openrouter", "free-model");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    const result = await chain.complete({ message: "hi", context: [] });

    expect(result.text).toBe("served by openrouter");
    // Metering must bill the upstream that actually answered, not the one we hoped for.
    expect(chain.provider).toBe("openrouter");
    expect(chain.model).toBe("free-model");
  });

  it("degrades when the daily FreeBuff pool is exhausted", async () => {
    const relay = new FakeAdapter(
      "freebuff",
      "deepseek/deepseek-v4-flash",
      thrower(new ProviderRateLimitError("freebuff rate-limited (429)", 429)),
    );
    const backup = new FakeAdapter("groq", "llama-free");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "groq-free", adapter: backup },
    ]);

    await expect(chain.complete({ message: "hi", context: [] })).resolves.toMatchObject({
      text: "served by groq",
    });
  });

  it("degrades on a rejected operator token instead of blaming the team's own keys", async () => {
    const relay = new FakeAdapter(
      "freebuff",
      "deepseek/deepseek-v4-flash",
      thrower(new Error("freebuff API key was rejected (403). Update the key under Team → AI API keys.")),
    );
    const backup = new FakeAdapter("openrouter", "free-model");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    await expect(chain.complete({ message: "hi", context: [] })).resolves.toMatchObject({
      text: "served by openrouter",
    });
  });

  it("does not burn the backup pool on an error every upstream would reject", async () => {
    const relay = new FakeAdapter(
      "freebuff",
      "deepseek/deepseek-v4-flash",
      thrower(new Error("freebuff chat failed (400) model=deepseek")),
    );
    const backup = new FakeAdapter("openrouter", "free-model");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    await expect(chain.complete({ message: "hi", context: [] })).rejects.toThrow(/400/);
    expect(backup.calls).toHaveLength(0);
  });

  it("names every attempt when the whole chain is down", async () => {
    const relay = new FakeAdapter("freebuff", "flash", thrower(connectionRefused()));
    const backup = new FakeAdapter(
      "openrouter",
      "free-model",
      thrower(new ProviderRateLimitError("openrouter rate-limited (429)", 429)),
    );
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    await expect(chain.complete({ message: "hi", context: [] })).rejects.toThrow(
      /freebuff: .*fetch failed.*openrouter-free: .*429/s,
    );
  });

  it("replays the identical prompt, context, and tools on the retry", async () => {
    const relay = new FakeAdapter("freebuff", "flash", thrower(connectionRefused()));
    const backup = new FakeAdapter("openrouter", "free-model");
    const chain = new RelayFailoverChatAdapter([
      { label: "freebuff", adapter: relay },
      { label: "openrouter-free", adapter: backup },
    ]);

    const context: ContextItem[] = [
      { type: "team_memory", id: "n1", content: "pit scouting note", importance: 3 },
    ];
    await chain.complete({
      message: "what should we pick?",
      context,
      tools: [{ name: "lookup" }] as never,
    });

    expect(backup.calls[0]).toEqual({
      message: "what should we pick?",
      context,
      toolCount: 1,
    });
  });

  it("reports native tool support only when every upstream has it", () => {
    const withTools = new FakeAdapter("freebuff", "flash");
    const withoutTools = {
      provider: "legacy",
      model: "m",
      supportsNativeTools: false,
      complete: async () => ({ text: "", promptTokens: 0, completionTokens: 0, costUsd: 0 }),
    } satisfies ChatAdapter;

    expect(
      new RelayFailoverChatAdapter([{ label: "a", adapter: withTools }]).supportsNativeTools,
    ).toBe(true);
    expect(
      new RelayFailoverChatAdapter([
        { label: "a", adapter: withTools },
        { label: "b", adapter: withoutTools },
      ]).supportsNativeTools,
    ).toBe(false);
  });
});

describe("tryCreatePlatformRelayAdapter", () => {
  it("is null with no relay configured, even when free pools exist", () => {
    // The free pools alone are the generic free tier, not a platform_relay grant —
    // returning null here is what lets the resolver skip the grant lookup entirely.
    expect(
      tryCreatePlatformRelayAdapter({
        env: { OPENROUTER_API_KEY: "sk-or-test", GROQ_API_KEY: "groq-test" } as NodeJS.ProcessEnv,
      }),
    ).toBeNull();
  });

  it("puts FreeBuff first and the free pools behind it", () => {
    const chain = tryCreatePlatformRelayAdapter({
      env: {
        FREE_RELAY_BASE_URL: "https://relay.example.org/v1",
        FREE_RELAY_API_KEY: "relay-secret",
        FREE_RELAY_MODEL: "deepseek/deepseek-v4-flash",
        FREE_RELAY_PROVIDER: "freebuff",
        OPENROUTER_API_KEY: "sk-or-test",
        GROQ_API_KEY: "groq-test",
      } as NodeJS.ProcessEnv,
    });

    expect(chain).not.toBeNull();
    expect(chain!.configuredLabels).toEqual([
      "freebuff:relay.example.org",
      "openrouter-free",
      "groq-free",
    ]);
    expect(chain!.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("is a lone-relay chain when no fallback pool is configured", () => {
    const chain = tryCreatePlatformRelayAdapter({
      env: {
        FREE_RELAY_BASE_URL: "http://127.0.0.1:3457/v1",
        FREE_RELAY_API_KEY: "relay-secret",
      } as NodeJS.ProcessEnv,
    });

    expect(chain!.configuredLabels).toEqual(["free-relay:127.0.0.1:3457"]);
  });

  it("puts every configured Pi tunnel ahead of the free pools", () => {
    const chain = tryCreatePlatformRelayAdapter({
      env: {
        FREE_RELAY_BASE_URL: "http://127.0.0.1:8080/v1,http://127.0.0.1:8081/v1",
        FREE_RELAY_API_KEY: "relay-secret",
        OPENROUTER_API_KEY: "sk-or-test",
      } as NodeJS.ProcessEnv,
    });

    expect(chain!.configuredLabels).toEqual([
      "free-relay:127.0.0.1:8080",
      "free-relay:127.0.0.1:8081",
      "openrouter-free",
    ]);
  });
});

describe("relay pool rotation", () => {
  it("spreads successive chats across both Pi tunnels", async () => {
    resetRelayRotateCursor();
    const first = new FakeAdapter("relay-a", "glm/glm-5.3-flash");
    const second = new FakeAdapter("relay-b", "mimo/mimo-2.5");
    const adapter = new RelayFailoverChatAdapter(
      [
        { label: "a", kind: "relay", adapter: first },
        { label: "b", kind: "relay", adapter: second },
      ],
      { rotateRelays: true },
    );

    await adapter.complete({ message: "one", context: [] });
    await adapter.complete({ message: "two", context: [] });

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    expect(first.calls[0]?.message).toBe("one");
    expect(second.calls[0]?.message).toBe("two");
  });
});
