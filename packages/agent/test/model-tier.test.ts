import { describe, expect, it } from "vitest";
import {
  classifyModelTier,
  degradedNoticeCopy,
  isLocalOrLanOrigin,
} from "../src/model-tier";

describe("isLocalOrLanOrigin", () => {
  it("flags loopback and localhost origins", () => {
    expect(isLocalOrLanOrigin("http://localhost:11434")).toBe(true);
    expect(isLocalOrLanOrigin("http://127.0.0.1:1234")).toBe(true);
    expect(isLocalOrLanOrigin("http://[::1]:8080")).toBe(true);
    expect(isLocalOrLanOrigin("http://app.localhost:3000")).toBe(true);
  });

  it("flags RFC1918 / link-local / mDNS LAN origins", () => {
    expect(isLocalOrLanOrigin("http://192.168.1.42:11434")).toBe(true);
    expect(isLocalOrLanOrigin("http://10.0.0.5:8000")).toBe(true);
    expect(isLocalOrLanOrigin("http://172.16.0.9:5000")).toBe(true);
    expect(isLocalOrLanOrigin("http://172.31.255.1")).toBe(true);
    expect(isLocalOrLanOrigin("http://169.254.10.10")).toBe(true);
    expect(isLocalOrLanOrigin("http://workshop-pc:11434")).toBe(true);
    expect(isLocalOrLanOrigin("http://gaming-rig.local:1234")).toBe(true);
  });

  it("does not flag public origins", () => {
    expect(isLocalOrLanOrigin("https://api.openai.com")).toBe(false);
    expect(isLocalOrLanOrigin("https://api.anthropic.com")).toBe(false);
    expect(isLocalOrLanOrigin("https://openrouter.ai")).toBe(false);
    expect(isLocalOrLanOrigin("https://my-tunnel.example.com")).toBe(false);
    expect(isLocalOrLanOrigin("http://172.32.0.1")).toBe(false);
    expect(isLocalOrLanOrigin("http://11.0.0.1")).toBe(false);
    expect(isLocalOrLanOrigin(null)).toBe(false);
    expect(isLocalOrLanOrigin("")).toBe(false);
  });
});

describe("classifyModelTier", () => {
  it("classifies current flagship families as frontier", () => {
    for (const modelId of [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-sonnet-5",
      "claude-3-5-sonnet-20241022",
      "gpt-5",
      "gpt-5.1",
      "gpt-4.1",
      "gpt-4o",
      "o3",
      "gemini-2.5-pro",
    ]) {
      expect(classifyModelTier({ provider: "any", modelId }).tier, modelId).toBe("frontier");
    }
  });

  it("classifies mini/flash/haiku-class hosted models as capable", () => {
    for (const modelId of [
      "gpt-4.1-mini",
      "gpt-4o-mini",
      "gpt-5-nano",
      "claude-haiku-4-5",
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "command-r-08-2024",
      "openrouter/free",
    ]) {
      expect(classifyModelTier({ provider: "any", modelId }).tier, modelId).toBe("capable");
    }
  });

  it("classifies open-weight small-model families as small-or-local", () => {
    for (const modelId of [
      "llama-3.1-8b-instant",
      "llama3.1-8b",
      "qwen2.5:14b",
      "gemma-2-9b-it",
      "phi-4",
      "mistral-small-latest",
      "deepseek-r1-distill-qwen-7b",
      "tinyllama",
      "codellama:13b",
      "vantage-local-chat-v1",
    ]) {
      expect(classifyModelTier({ provider: "any", modelId }).tier, modelId).toBe("small-or-local");
    }
  });

  it("classifies anything on a localhost/LAN origin as small-or-local, whatever the name", () => {
    const result = classifyModelTier({
      provider: "openai-compatible",
      modelId: "my-finetune-v2",
      baseUrlOrigin: "http://127.0.0.1:11434",
    });
    expect(result.tier).toBe("small-or-local");
    expect(result.reason).toContain("local");

    expect(
      classifyModelTier({
        provider: "openai-compatible",
        modelId: "gpt-4.1",
        baseUrlOrigin: "http://192.168.0.20:1234",
      }).tier,
    ).toBe("small-or-local");
  });

  it("keeps provider default origins classified by model family", () => {
    expect(
      classifyModelTier({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        baseUrlOrigin: "https://api.anthropic.com",
      }).tier,
    ).toBe("frontier");
  });

  it("marks unrecognized models unknown without claiming degradation", () => {
    const result = classifyModelTier({
      provider: "openai-compatible",
      modelId: "sovereign-mixture-9000",
      baseUrlOrigin: "https://models.example.com",
    });
    expect(result.tier).toBe("unknown");
    expect(result.reason).toBe("custom model — quality depends on what you chose");
    expect(result.reason).not.toMatch(/degrad|worse|rough/i);
  });

  it("treats missing model ids as unknown", () => {
    expect(classifyModelTier({ modelId: null }).tier).toBe("unknown");
    expect(classifyModelTier({ modelId: "" }).tier).toBe("unknown");
  });
});

describe("degradedNoticeCopy", () => {
  it("returns null for frontier models", () => {
    expect(degradedNoticeCopy("frontier", "claude-opus-4-20250514")).toBeNull();
  });

  it("returns the smaller-model notice for small-or-local", () => {
    const notice = degradedNoticeCopy("small-or-local", "qwen2.5:14b");
    expect(notice).toContain("qwen2.5:14b");
    expect(notice).toContain("smaller model than Vantage's frontier defaults");
    expect(notice).toContain("expect rougher output");
  });

  it("returns a softer notice for capable models", () => {
    const notice = degradedNoticeCopy("capable", "gpt-4.1-mini");
    expect(notice).toContain("gpt-4.1-mini");
    expect(notice).not.toContain("rougher");
  });

  it("returns a neutral notice for unknown models", () => {
    const notice = degradedNoticeCopy("unknown", "sovereign-mixture-9000");
    expect(notice).toContain("quality depends on what you chose");
    expect(notice).not.toMatch(/smaller|rougher|degrad/i);
  });

  it("never interpolates an empty model name", () => {
    expect(degradedNoticeCopy("capable", "  ")).toContain("the configured model");
  });
});
