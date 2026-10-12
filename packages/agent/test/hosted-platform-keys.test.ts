import { describe, expect, it } from "vitest";
import {
  HOSTED_ANTHROPIC_MODEL,
  hostedAnthropicEffort,
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

  it("answers every hosted Anthropic feature with Claude Haiku 5.5, High effort for CAD/code", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    expect(HOSTED_ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "chat" })?.model).toBe(HOSTED_ANTHROPIC_MODEL);
    expect(tryCreateHostedAnthropicAdapter({ env, feature: "cad" })?.model).toBe(HOSTED_ANTHROPIC_MODEL);
    expect(hostedAnthropicEffort("chat")).toBe("medium");
    expect(hostedAnthropicEffort("cad")).toBe("high");
    expect(tryCreateHostedAnthropicAdapter({ env: {} })).toBeNull();
  });
});
