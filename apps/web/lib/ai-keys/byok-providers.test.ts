import { describe, expect, it } from "vitest";
import {
  buildByokKeyStatuses,
  parseByokProvider,
} from "./byok-providers";
import { aiKeysBillingNote, classifyAiKeysShell } from "./ai-keys-related";

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
});

describe("ai keys soft-ui helpers", () => {
  it("classifies setup when KMS is missing", () => {
    expect(
      classifyAiKeysShell({ loading: false, hasOrg: true, setupRequired: true }),
    ).toBe("setup");
  });

  it("frames free vs paid without double-billing confusion", () => {
    expect(aiKeysBillingNote("free").title).toMatch(/your keys/i);
    expect(aiKeysBillingNote("team").body).toMatch(/hosted/i);
    expect(aiKeysBillingNote("team").body).toMatch(/not billed twice|does not consume/i);
  });
});

describe("byok model catalog re-export", () => {
  it("exposes automode helpers from agent", async () => {
    const { preferredTierForFeature, BYOK_MODEL_OPTIONS } = await import("./byok-model-catalog");
    expect(preferredTierForFeature("cad")).toBe("high");
    expect(BYOK_MODEL_OPTIONS.some((m) => m.modelId === "gpt-4.1-mini")).toBe(true);
    expect(BYOK_MODEL_OPTIONS.every((m) => m.modelId.length > 0)).toBe(true);
  });
});
