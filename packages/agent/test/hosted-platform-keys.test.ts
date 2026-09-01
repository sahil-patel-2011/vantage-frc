import { describe, expect, it } from "vitest";
import {
  HOSTED_ANTHROPIC_OPUS,
  HOSTED_ANTHROPIC_SONNET,
  OPENROUTER_FREE_MODEL,
  readFreeRelayConfig,
  tryCreateFreeRelayAdapter,
  tryCreateGroqFreeAdapter,
  tryCreateHostedAnthropicAdapter,
  tryCreateOpenRouterFreeAdapter,
} from "../src/hosted-platform-keys";

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
      model: "freebuff",
      providerLabel: "free-relay",
    });
    expect(tryCreateFreeRelayAdapter({ env })?.provider).toBe("openai-compatible");
  });

  it("routes paid hosted Anthropic to Sonnet, Opus for CAD/code", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "chat" })?.model).toBe(HOSTED_ANTHROPIC_SONNET);
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "cad" })?.model).toBe(HOSTED_ANTHROPIC_OPUS);
    expect(tryCreateHostedAnthropicAdapter({ env: {} })).toBeNull();
  });
});
