import { describe, expect, it, vi } from "vitest";
import { HttpChatAdapter } from "../src/http-chat-adapter";
import { ModelFallbackChatAdapter } from "../src/model-fallback-adapter";
import { AiHordeAdapter } from "../src/ai-horde-pool";
import { PetalsPublicPoolAdapter } from "../src/petals-public-pool";
import { SubscriptionBridgeChatAdapter } from "../src/subscription-bridge-adapter";
import { LocalDeterministicChatAdapter, type ChatAdapter } from "../src/index";
import { assertRemoteImageAdapter, assertTextOnlyChatInput, MAX_CHAT_IMAGE_BASE64_CHARS, validateChatPngImage, validateChatPngImages } from "../src/chat-image";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = { mimeType: "image/png" as const, dataBase64: png };
function fixture(provider: "anthropic" | "openai" | "openai-compatible" = "openai", baseUrl?: string, apiKey = "fixture-key") {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(provider === "anthropic"
    ? { content: [{ type: "text", text: "Observed" }], usage: { input_tokens: 23, output_tokens: 4 } }
    : { choices: [{ message: { content: "Observed" } }], usage: { prompt_tokens: 23, completion_tokens: 4 } }),
  { status: 200, headers: { "content-type": "application/json" } }));
  const adapter = new HttpChatAdapter({ provider, baseUrl, apiKey, model: "fixture-vision", promptCachingEnabled: false,
    prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, fetchImpl, capability: "cad" });
  return { adapter, fetchImpl };
}

describe("bounded remote chat screenshots", () => {
  it("validates a single bounded PNG without accepting URLs, noncanonical base64 or oversized dimensions", () => {
    expect(validateChatPngImage(image)).toMatchObject({ width: 1, height: 1, image });
    for (const invalid of [null, { ...image, mimeType: "image/jpeg" }, { ...image, url: "https://elsewhere.test/a.png" },
      { ...image, dataBase64: `data:image/png;base64,${png}` }, { ...image, dataBase64: png + "\n" },
      { ...image, dataBase64: "A".repeat(MAX_CHAT_IMAGE_BASE64_CHARS + 4) }]) {
      expect(() => validateChatPngImage(invalid)).toThrow();
    }
    const large = Buffer.from(png, "base64");
    large.writeUInt32BE(4097, 16);
    expect(() => validateChatPngImage({ ...image, dataBase64: large.toString("base64") })).toThrow("4096");
    expect(() => validateChatPngImage({ ...image, dataBase64: Buffer.from(png, "base64").subarray(0, -12).toString("base64") })).toThrow("incomplete");
  });

  it("sends image blocks only in the current Anthropic user turn and forbids redirects", async () => {
    const { adapter, fetchImpl } = fixture("anthropic");
    assertRemoteImageAdapter(adapter);
    const result = await adapter.complete({ message: "Inspect", context: [], image, history: [{ role: "user", content: "Earlier" }] });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toBe("Earlier");
    expect(body.messages.at(-1).content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png } });
    expect(body.messages.at(-1).content[1]).toMatchObject({ type: "text" });
    expect(JSON.stringify(body.system)).not.toContain(png);
    expect(result.promptTokens).toBe(23);
  });

  it("uses inline image_url data for OpenAI-compatible remote providers and keeps text calls unchanged", async () => {
    for (const provider of ["openai", "openai-compatible"] as const) {
      const { adapter, fetchImpl } = fixture(provider, provider === "openai-compatible" ? "https://generativelanguage.googleapis.com/v1beta/openai" : undefined);
      await adapter.complete({ message: "Inspect", context: [], image });
      const init = fetchImpl.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(String(init.body));
      expect(body.messages.at(-1).content[0]).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${png}`, detail: "high" } });
      expect(body.messages[0].content).not.toContain(png);
      await adapter.complete({ message: "Text only", context: [] });
      const textInit = fetchImpl.mock.calls[1]![1] as RequestInit;
      expect(textInit.redirect).toBeUndefined();
      expect(typeof JSON.parse(String(textInit.body)).messages.at(-1).content).toBe("string");
    }
  });

  it("rejects local, custom, credentialless and unsupported routes before any provider request", async () => {
    for (const baseUrl of ["http://localhost:11434/v1", "https://127.0.0.1/v1", "https://custom.example/v1", "https://api.openai.com.attacker.test/v1", "https://api.openai.com/v1?proxy=local"]) {
      const f = fixture("openai-compatible", baseUrl);
      expect(() => assertRemoteImageAdapter(f.adapter)).toThrow("supported remote");
      await expect(f.adapter.complete({ message: "Inspect", context: [], image })).rejects.toThrow("supported remote");
      expect(f.fetchImpl).not.toHaveBeenCalled();
    }
    const noKey = fixture("openai", undefined, "");
    await expect(noKey.adapter.complete({ message: "Inspect", context: [], image })).rejects.toThrow();
    expect(noKey.fetchImpl).not.toHaveBeenCalled();
    expect(() => assertRemoteImageAdapter({})).toThrow();
    expect(() => assertTextOnlyChatInput({ image })).toThrow("does not accept");
    expect(() => assertTextOnlyChatInput({ message: "Text", image: undefined })).not.toThrow();
  });

  it("does not allow a remote model fallback chain to fall through to a local endpoint", async () => {
    const remote = fixture(), local = fixture("openai-compatible", "http://localhost:11434/v1");
    const adapter = new ModelFallbackChatAdapter([remote.adapter, local.adapter]);
    await expect(adapter.complete({ message: "Inspect", context: [], image })).rejects.toThrow("supported remote");
    expect(remote.fetchImpl).not.toHaveBeenCalled();
    expect(local.fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds screenshot plus drawing and preserves their order in the current turn", async () => {
    expect(validateChatPngImages([image, image])).toHaveLength(2);
    expect(() => validateChatPngImages([])).toThrow();
    expect(() => validateChatPngImages([image, image, image])).toThrow();
    // Structurally bounded PNG with an ancillary chunk: no image decompression
    // is necessary to reject the combined byte size before a provider request.
    const source = Buffer.from(png, "base64");
    const ancillary = Buffer.alloc(1_600_012);
    ancillary.writeUInt32BE(1_600_000, 0);
    ancillary.write("tEXt", 4, "ascii");
    const padded = { ...image, dataBase64: Buffer.concat([source.subarray(0, 33), ancillary, source.subarray(33)]).toString("base64") };
    expect(() => validateChatPngImages([padded, padded])).toThrow("total at most 3 MiB");
    const f = fixture("anthropic");
    await f.adapter.complete({ message: "First is UI; second is drawing.", context: [], images: [image, image] });
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body));
    expect(body.messages.at(-1).content.map((item: { type: string }) => item.type)).toEqual(["image", "image", "text"]);
    f.fetchImpl.mockClear();
    await expect(f.adapter.complete({ message: "Inspect", context: [], image, images: [image] })).rejects.toThrow("not both");
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses image turns before any public swarm request, local work or subscription enqueue", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = { enqueue: vi.fn(), poll: vi.fn(), abandon: vi.fn() };
    const adapters: ChatAdapter[] = [
      new LocalDeterministicChatAdapter(),
      new AiHordeAdapter({ baseUrl: "https://aihorde.net/api/v2", apiKey: "test", capability: "cad", fetchImpl }),
      new PetalsPublicPoolAdapter({ generateUrl: "https://chat.petals.dev/api/v1/generate", model: "fixture", capability: "cad", fetchImpl }),
      new SubscriptionBridgeChatAdapter({ transport, orgId: "fixture", userId: "fixture", feature: "cad", requestedEngine: "codex" }),
    ];
    for (const adapter of adapters) {
      await expect(adapter.complete({ message: "Inspect", context: [], images: [image] })).rejects.toThrow("does not accept screenshots");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(transport.enqueue).not.toHaveBeenCalled();
  });

  it("enforces explicit output reservations on Anthropic, OpenAI and compatible providers", async () => {
    for (const provider of ["anthropic", "openai", "openai-compatible"] as const) {
      const f = fixture(provider, provider === "openai-compatible" ? "https://generativelanguage.googleapis.com/v1beta/openai" : undefined);
      await f.adapter.complete({ message: "Inspect", context: [], image, maxCompletionTokens: 2500 });
      const body = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body));
      expect(body[provider === "openai" ? "max_completion_tokens" : "max_tokens"]).toBe(2500);
      f.fetchImpl.mockClear();
      for (const maxCompletionTokens of [0, -1, 4097, 1.5, NaN]) {
        await expect(f.adapter.complete({ message: "Inspect", context: [], maxCompletionTokens })).rejects.toThrow("completion limit");
      }
      expect(f.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("does not start an aborted turn and propagates cancellation without calling it a provider timeout", async () => {
    const f = fixture();
    const stopped = new AbortController();
    stopped.abort();
    await expect(f.adapter.complete({ message: "Inspect", context: [], image, signal: stopped.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
    const controller = new AbortController();
    f.fetchImpl.mockImplementationOnce(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Cancelled by user", "AbortError");
    });
    await expect(f.adapter.complete({ message: "Inspect", context: [], image, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
