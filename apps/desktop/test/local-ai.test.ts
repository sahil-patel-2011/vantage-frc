import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LM_STUDIO_URL,
  checkLocalAiRequirements,
  localChat,
  localEngineReport,
  parseModelList,
  pickLocalModel,
  sanitizeLocalModelUrl,
  stripReasoning,
} from "../src/local-ai";

const GiB = 1024 ** 3;
const GB = 1000 ** 3;

describe("local AI requirements", () => {
  it("passes a 16 GB laptop with room on disk, including the GPU's share of memory", () => {
    expect(checkLocalAiRequirements({ totalMemBytes: 15.8 * GiB, freeDiskBytes: 40 * GB }).ok).toBe(true);
  });

  it("says what is short, in numbers", () => {
    const report = checkLocalAiRequirements({ totalMemBytes: 8 * GiB, freeDiskBytes: 9 * GB });
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      "Local AI needs at least 16 GB of memory; this computer has 8 GB.",
      "Local AI needs at least 15 GB of free disk space; 9 GB is free.",
    ]);
  });
});

describe("LM Studio address", () => {
  it("only ever talks to this computer", () => {
    expect(sanitizeLocalModelUrl("http://localhost:1234")).toBe("http://localhost:1234/v1");
    expect(sanitizeLocalModelUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
    expect(sanitizeLocalModelUrl("http://192.168.1.20:1234/v1")).toBe(DEFAULT_LM_STUDIO_URL);
    expect(sanitizeLocalModelUrl("https://evil.example/v1")).toBe(DEFAULT_LM_STUDIO_URL);
    expect(sanitizeLocalModelUrl("file:///etc/passwd")).toBe(DEFAULT_LM_STUDIO_URL);
  });
});

describe("model list and choice", () => {
  const models = parseModelList({ data: [{ id: "text-embedding-nomic" }, { id: "llama-3.2-3b" }, { id: "qwen3-8b" }] });
  it("drops embedding models", () => {
    expect(models).toEqual(["llama-3.2-3b", "qwen3-8b"]);
  });
  it("keeps the saved model, else prefers Qwen, else the first", () => {
    expect(pickLocalModel(models, "llama-3.2-3b")).toBe("llama-3.2-3b");
    expect(pickLocalModel(models, "gone")).toBe("qwen3-8b");
    expect(pickLocalModel(["phi-4"], null)).toBe("phi-4");
    expect(pickLocalModel([], null)).toBeNull();
  });
});

describe("local chat", () => {
  it("returns the answer without the model's thinking", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ model: "qwen3-8b", choices: [{ message: { content: "<think>hmm</think>Defend 254." } }], usage: { prompt_tokens: 10, completion_tokens: 3 } })),
    );
    const result = await localChat({ fetcher: fetcher as unknown as typeof fetch, baseUrl: DEFAULT_LM_STUDIO_URL, model: "qwen3-8b", prompt: "plan", timeoutMs: 5_000 });
    expect(result).toEqual({ ok: true, text: "Defend 254.", model: "qwen3-8b", usage: { inputTokens: 10, outputTokens: 3 } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:1234/v1/chat/completions");
  });

  it("explains a server that isn't running instead of throwing", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await localChat({ fetcher: fetcher as unknown as typeof fetch, baseUrl: DEFAULT_LM_STUDIO_URL, model: "m", prompt: "p", timeoutMs: 5_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorClass).toBe("local_model_unavailable");
  });

  it("strips an unclosed leading think block too", () => {
    expect(stripReasoning("reasoning…</think>\nAnswer")).toBe("Answer");
  });
});

describe("heartbeat report", () => {
  it("is available only when switched on, reachable and with a model", () => {
    expect(localEngineReport({ reachable: true, model: "qwen3-8b", enabled: true }).lmstudio.available).toBe(true);
    expect(localEngineReport({ reachable: true, model: "qwen3-8b", enabled: false }).lmstudio.available).toBe(false);
    expect(localEngineReport({ reachable: false, model: "qwen3-8b", enabled: true }).lmstudio.available).toBe(false);
    expect(localEngineReport({ reachable: true, model: null, enabled: true }).lmstudio.available).toBe(false);
  });
});
