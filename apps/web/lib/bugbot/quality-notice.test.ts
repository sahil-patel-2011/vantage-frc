import { describe, expect, it } from "vitest";
import { classifyModelTier, degradedNoticeCopy } from "@vantage/agent/model-tier";
import { bugbotQualityNotice } from "./quality-notice";

describe("bugbotQualityNotice", () => {
  it("never notices Ultra — hosted stays hosted, even on a small model id", () => {
    expect(
      bugbotQualityNotice({
        mode: "ultra",
        provider: "openai-compatible",
        modelId: "qwen2.5:14b",
        baseUrlOrigin: "http://127.0.0.1:11434",
      }),
    ).toBeNull();
    expect(
      bugbotQualityNotice({
        mode: "ultra",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      }),
    ).toBeNull();
  });

  it("matches chat copy for a subscription small/local model", () => {
    const notice = bugbotQualityNotice({
      mode: "subscription",
      provider: "openai-compatible",
      modelId: "qwen2.5:14b",
    });
    expect(notice).toBe(degradedNoticeCopy("small-or-local", "qwen2.5:14b"));
    expect(notice).toContain("smaller model than Vantage's frontier defaults");
    expect(notice).toContain("expect rougher output");
  });

  it("flags a localhost origin on subscription as small-or-local, whatever the name", () => {
    const notice = bugbotQualityNotice({
      mode: "subscription",
      provider: "openai-compatible",
      modelId: "workshop-finetune-v3",
      baseUrlOrigin: "http://127.0.0.1:11434",
    });
    expect(classifyModelTier({
      provider: "openai-compatible",
      modelId: "workshop-finetune-v3",
      baseUrlOrigin: "http://127.0.0.1:11434",
    }).tier).toBe("small-or-local");
    expect(notice).toBe(degradedNoticeCopy("small-or-local", "workshop-finetune-v3"));
  });

  it("returns null for a frontier subscription model (same as chat)", () => {
    expect(
      bugbotQualityNotice({
        mode: "subscription",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        baseUrlOrigin: "https://api.anthropic.com",
      }),
    ).toBeNull();
  });

  it("returns the capable chat notice for hosted mini-class subscription models", () => {
    expect(
      bugbotQualityNotice({
        mode: "subscription",
        provider: "openai",
        modelId: "gpt-4.1-mini",
      }),
    ).toBe(degradedNoticeCopy("capable", "gpt-4.1-mini"));
  });

  it("does not claim degradation when the model is unknown", () => {
    const notice = bugbotQualityNotice({
      mode: "subscription",
      provider: "openai-compatible",
      modelId: "sovereign-mixture-9000",
      baseUrlOrigin: "https://models.example.com",
    });
    expect(classifyModelTier({
      provider: "openai-compatible",
      modelId: "sovereign-mixture-9000",
      baseUrlOrigin: "https://models.example.com",
    }).tier).toBe("unknown");
    expect(notice).toBe(degradedNoticeCopy("unknown", "sovereign-mixture-9000"));
    expect(notice).toContain("quality depends on what you chose");
    expect(notice).not.toMatch(/degrad|worse|rough|smaller/i);
  });

  it("treats a missing model id as unknown — no degradation claim", () => {
    const notice = bugbotQualityNotice({ mode: "subscription", modelId: null });
    expect(notice).toBe(degradedNoticeCopy("unknown", ""));
    expect(notice).not.toMatch(/degrad|worse|rough|smaller/i);
  });
});
