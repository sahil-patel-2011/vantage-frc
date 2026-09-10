import { describe, expect, it } from "vitest";
import {
  buildByokKeyStatuses,
  matchOpenaiBasePreset,
  parseByokProvider,
  parseOptionalBaseUrl,
} from "./byok-providers";
import { AI_KEYS_RELATED_INCLUDE, aiKeysBillingNote, aiKeysShellCopy, classifyAiKeysShell } from "./ai-keys-related";

describe("byok providers", () => {
  it("parses gemini as google", () => {
    expect(parseByokProvider("gemini")).toBe("google");
    expect(parseByokProvider("OpenAI")).toBe("openai");
    expect(parseByokProvider("OpenRouter")).toBe("openrouter");
    expect(parseByokProvider("nope")).toBeNull();
  });

  it("builds configured/missing status without secrets", () => {
    const statuses = buildByokKeyStatuses([
      { provider: "anthropic", createdAt: "2026-01-02T00:00:00Z", lastUsedAt: null },
      { provider: "openai", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: "2026-01-03T00:00:00Z" },
    ]);
    expect(statuses).toHaveLength(4);
    expect(statuses.find((row) => row.provider === "openai")?.configured).toBe(true);
    expect(statuses.find((row) => row.provider === "anthropic")?.configured).toBe(true);
    expect(statuses.find((row) => row.provider === "google")?.configured).toBe(false);
    expect(statuses.find((row) => row.provider === "openrouter")?.configured).toBe(false);
    expect(JSON.stringify(statuses)).not.toMatch(/sk-|AIza|ciphertext/i);
  });

  it("matches Ollama and LM Studio presets from a base URL", () => {
    expect(matchOpenaiBasePreset(null)).toBe("openai");
    expect(matchOpenaiBasePreset("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(matchOpenaiBasePreset("http://127.0.0.1:1234/v1")).toBe("lmstudio");
    expect(parseOptionalBaseUrl(" https://proxy.example/v1/ ")).toBe("https://proxy.example/v1");
    expect(parseOptionalBaseUrl("")).toBeNull();
  });
});

describe("ai keys soft-ui helpers", () => {
  it("classifies setup when KMS is missing", () => {
    expect(
      classifyAiKeysShell({ loading: false, hasOrg: true, setupRequired: true }),
    ).toBe("setup");
  });

  it("frames free vs paid without double-billing confusion", () => {
    expect(aiKeysBillingNote("free").title).toMatch(/your keys/i);
    expect(aiKeysBillingNote("free").body).not.toMatch(/workspace/i);
    expect(aiKeysBillingNote("team").body).toMatch(/hosted/i);
    expect(aiKeysBillingNote("team").body).toMatch(/not billed twice|does not consume/i);
  });

  it("empty copy says team, not workspace", () => {
    const copy = aiKeysShellCopy("empty");
    expect(copy.title).toMatch(/team/i);
    expect(`${copy.eyebrow} ${copy.badge} ${copy.title} ${copy.description}`).not.toMatch(/workspace/i);
  });

  it("keeps the keys page related strip to chat only", () => {
    expect(AI_KEYS_RELATED_INCLUDE).toEqual(["chat"]);
  });
});

describe("byok model catalog re-export", () => {
  it("exposes automode helpers from agent", { timeout: 15_000 }, async () => {
    const { preferredTierForFeature, BYOK_MODEL_OPTIONS } = await import("./byok-model-catalog");
    expect(preferredTierForFeature("cad")).toBe("high");
    expect(BYOK_MODEL_OPTIONS.some((m) => m.modelId === "gpt-4.1-mini")).toBe(true);
    expect(BYOK_MODEL_OPTIONS.every((m) => m.modelId.length > 0)).toBe(true);
  });
});
