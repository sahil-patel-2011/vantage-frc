import { describe, expect, it } from "vitest";
import {
  HOSTED_ANTHROPIC_OPUS,
  HOSTED_ANTHROPIC_SONNET,
  OPENROUTER_FREE_MODEL,
  describeFreeRelayRefusal,
  freeRelayExtraHeaders,
  freeRelayRefusal,
  parseFreeRelayBaseUrls,
  readFreeRelayConfig,
  readFreeRelayConfigs,
  tryCreateFreeRelayAdapter,
  tryCreateGroqFreeAdapter,
  tryCreateHostedAnthropicAdapter,
  tryCreateOpenRouterFreeAdapter,
} from "../src/hosted-platform-keys";
import { FREEBUFF_UNMETERED_DEFAULT } from "../src/freebuff-models";

describe("hosted platform keys", () => {
  it("skips OpenRouter when the platform key is missing", () => {
    expect(tryCreateOpenRouterFreeAdapter({ env: {} })).toBeNull();
  });

  it("builds an OpenRouter free adapter without logging the key", () => {
    const adapter = tryCreateOpenRouterFreeAdapter({
      env: { OPENROUTER_API_KEY: "sk-or-test", OPENROUTER_APP_TITLE: "Vantage" },
    });
    expect(adapter?.provider).toBe("openai-compatible");
    expect(adapter?.model).toBe(OPENROUTER_FREE_MODEL);
    expect(adapter).toBeTruthy();
  });

  it("builds Groq and OpenAI-compatible local relay adapters only when configured", () => {
    expect(tryCreateGroqFreeAdapter({ env: {} })).toBeNull();
    expect(tryCreateGroqFreeAdapter({ env: { GROQ_API_KEY: "g-test" } })?.model).toBe(
      "llama-3.1-8b-instant",
    );

    expect(readFreeRelayConfig({})).toBeNull();
    const env = {
      FREE_RELAY_BASE_URL: "http://pi.local:8080/v1/",
      FREE_RELAY_MODEL: "freebuff",
    };
    expect(readFreeRelayConfig(env)).toMatchObject({
      baseUrl: "http://pi.local:8080/v1",
      // "freebuff" is not a slug, so it falls back to the unmetered default.
      model: FREEBUFF_UNMETERED_DEFAULT,
      providerLabel: "free-relay",
    });
    expect(tryCreateFreeRelayAdapter({ env })?.provider).toBe("openai-compatible");
    const tagged = tryCreateFreeRelayAdapter({
      env: { ...env, FREE_RELAY_API_KEY: "vr_test" },
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(tagged?.provider).toBe("openai-compatible");
    expect(tagged?.supportsNativeTools).toBe(false);
    expect(tryCreateFreeRelayAdapter({ env, capability: "cad" })?.supportsNativeTools).toBe(false);
  });

  it("refuses an internet-reachable relay that carries no key", () => {
    // A tunnel hostname with no key is an open pass-through to the platform's own
    // upstream account for anyone who finds the URL.
    const exposed = { FREE_RELAY_BASE_URL: "https://relay.example.org/v1" };
    expect(readFreeRelayConfig(exposed)).toBeNull();
    expect(tryCreateFreeRelayAdapter({ env: exposed })).toBeNull();
    expect(freeRelayRefusal(exposed)).toBe("public_url_without_key");
    expect(describeFreeRelayRefusal("public_url_without_key")).toMatch(/FREE_RELAY_API_KEY/);

    // Same URL with a key is accepted.
    expect(
      readFreeRelayConfig({ ...exposed, FREE_RELAY_API_KEY: "relay-secret" }),
    ).toMatchObject({ baseUrl: "https://relay.example.org/v1", apiKey: "relay-secret" });
  });

  it("accepts a comma-separated pool of Pi tunnels and tags team 6925 as default-fast", () => {
    expect(
      parseFreeRelayBaseUrls("https://a.trycloudflare.com/v1, https://b.trycloudflare.com/v1/"),
    ).toEqual(["https://a.trycloudflare.com/v1", "https://b.trycloudflare.com/v1"]);
    const env = {
      FREE_RELAY_BASE_URL: "https://a.trycloudflare.com/v1,https://b.trycloudflare.com/v1",
      FREE_RELAY_API_KEY: "relay-secret",
    };
    expect(readFreeRelayConfigs(env).map((row) => row.baseUrl)).toEqual([
      "https://a.trycloudflare.com/v1",
      "https://b.trycloudflare.com/v1",
    ]);
    expect(readFreeRelayConfig(env)?.baseUrl).toBe("https://a.trycloudflare.com/v1");
    expect(freeRelayExtraHeaders({ capability: "chat", orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", teamNumber: 6925 })).toMatchObject({
      "x-vantage-feature": "chat",
      "x-vantage-org-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "x-vantage-team-number": "6925",
      "x-vantage-priority": "1",
    });
    expect(freeRelayExtraHeaders({ capability: "chat", teamNumber: 254 })["x-vantage-priority"]).toBeUndefined();
  });

  it("still allows a keyless relay on loopback or the LAN, where nothing off-box can reach it", () => {
    expect(freeRelayRefusal({ FREE_RELAY_BASE_URL: "http://127.0.0.1:3457/v1" })).toBeNull();
    expect(freeRelayRefusal({ FREE_RELAY_BASE_URL: "http://pi.local:8080/v1" })).toBeNull();
    expect(freeRelayRefusal({ FREE_RELAY_BASE_URL: "http://192.168.1.42:3457/v1" })).toBeNull();
    expect(freeRelayRefusal({})).toBe("unset");
  });

  it("routes paid hosted Anthropic to Sonnet, Opus for CAD/code", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "chat" })?.model).toBe(HOSTED_ANTHROPIC_SONNET);
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "cad" })?.model).toBe(HOSTED_ANTHROPIC_OPUS);
    expect(tryCreateHostedAnthropicAdapter({ env: {} })).toBeNull();
  });
});
