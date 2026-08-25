import { describe, expect, it } from "vitest";
import {
  applyLmStudioContextLengths,
  discoverLocalModels,
  normalizeOllamaTags,
  normalizeOpenAiModelList,
  probeLmStudio,
  probeOllama,
  probeOpenAiCompatible,
} from "../src/local-models.js";
import { FakeTransport, ok } from "./helpers.js";

/**
 * Captured VERBATIM from the official Ollama API docs, "List Local Models"
 * (GET /api/tags) — https://github.com/ollama/ollama/blob/main/docs/api.md
 * (fetched 2026-08-24).
 */
const OLLAMA_TAGS_FIXTURE = `{
  "models": [
    {
      "name": "deepseek-r1:latest",
      "model": "deepseek-r1:latest",
      "modified_at": "2025-05-10T08:06:48.639712648-07:00",
      "size": 4683075271,
      "digest": "0a8c266910232fd3291e71e5ba1e058cc5af9d411192cf88b6d30e92b6e73163",
      "details": {
        "parent_model": "",
        "format": "gguf",
        "family": "qwen2",
        "families": ["qwen2"],
        "parameter_size": "7.6B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}`;

/**
 * The OpenAI-compatible ListModelsResponse LM Studio serves on GET /v1/models
 * (https://lmstudio.ai/docs/developer/openai-compat/models). Field set captured from the
 * official OpenAI OpenAPI spec's List-models response example —
 * https://github.com/openai/openai-openapi (openapi.yaml, fetched 2026-08-24; the spec's
 * printed example carries a trailing comma, removed here so it parses as strict JSON).
 */
const OPENAI_MODELS_FIXTURE = `{
  "object": "list",
  "data": [
    {
      "id": "model-id-0",
      "object": "model",
      "created": 1686935002,
      "owned_by": "organization-owner",
      "shutdown_date": null
    },
    {
      "id": "model-id-1",
      "object": "model",
      "created": 1686935002,
      "owned_by": "organization-owner",
      "shutdown_date": null
    },
    {
      "id": "model-id-2",
      "object": "model",
      "created": 1686935002,
      "owned_by": "openai",
      "shutdown_date": "2026-10-23"
    }
  ]
}`;

/**
 * Captured VERBATIM from the official LM Studio REST API docs, GET /api/v0/models —
 * https://lmstudio.ai/docs/developer/rest/endpoints (doc source
 * github.com/lmstudio-ai/docs 1_developer/2_rest/endpoints.mdx, fetched 2026-08-24).
 */
const LMSTUDIO_V0_MODELS_FIXTURE = `{
  "object": "list",
  "data": [
    {
      "id": "qwen2-vl-7b-instruct",
      "object": "model",
      "type": "vlm",
      "publisher": "mlx-community",
      "arch": "qwen2_vl",
      "compatibility_type": "mlx",
      "quantization": "4bit",
      "state": "not-loaded",
      "max_context_length": 32768
    },
    {
      "id": "meta-llama-3.1-8b-instruct",
      "object": "model",
      "type": "llm",
      "publisher": "lmstudio-community",
      "arch": "llama",
      "compatibility_type": "gguf",
      "quantization": "Q4_K_M",
      "state": "not-loaded",
      "max_context_length": 131072
    },
    {
      "id": "text-embedding-nomic-embed-text-v1.5",
      "object": "model",
      "type": "embeddings",
      "publisher": "nomic-ai",
      "arch": "nomic-bert",
      "compatibility_type": "gguf",
      "quantization": "Q4_0",
      "state": "not-loaded",
      "max_context_length": 2048
    }
  ]
}`;

/** /v1/models list matching the v0 fixture's ids (LM Studio serves the same ids on both). */
const LMSTUDIO_V1_MODELS_FIXTURE = JSON.stringify({
  object: "list",
  data: [
    { id: "qwen2-vl-7b-instruct", object: "model", created: 1731990317, owned_by: "organization_owner" },
    { id: "meta-llama-3.1-8b-instruct", object: "model", created: 1731990317, owned_by: "organization_owner" },
    { id: "text-embedding-nomic-embed-text-v1.5", object: "model", created: 1731990317, owned_by: "organization_owner" },
  ],
});

const parse = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

describe("normalizeOllamaTags (documented /api/tags shape)", () => {
  it("normalizes the doc fixture: id, label, and real byte size — no invented context length", () => {
    const models = normalizeOllamaTags(parse(OLLAMA_TAGS_FIXTURE));
    expect(models).toEqual([
      {
        provider: "ollama",
        modelId: "deepseek-r1:latest",
        label: "deepseek-r1:latest",
        sizeBytes: 4683075271,
      },
    ]);
    expect(models[0]).not.toHaveProperty("contextLength");
  });

  it("an empty models array is an honest empty list", () => {
    expect(normalizeOllamaTags({ models: [] })).toEqual([]);
  });

  it("unknown shapes and junk entries produce nothing, never a guess", () => {
    expect(normalizeOllamaTags(null)).toEqual([]);
    expect(normalizeOllamaTags({ data: [{ id: "x" }] })).toEqual([]); // OpenAI shape ≠ Ollama shape
    expect(normalizeOllamaTags({ models: [42, { size: 1 }, { name: "" }] })).toEqual([]);
  });

  it("skips a non-finite size instead of fabricating one", () => {
    const models = normalizeOllamaTags({ models: [{ name: "m", model: "m", size: "big" }] });
    expect(models).toEqual([{ provider: "ollama", modelId: "m", label: "m" }]);
  });
});

describe("normalizeOpenAiModelList (documented ListModelsResponse shape)", () => {
  it("normalizes the OpenAI spec fixture", () => {
    const models = normalizeOpenAiModelList(parse(OPENAI_MODELS_FIXTURE), "lmstudio");
    expect(models.map((model) => model.modelId)).toEqual(["model-id-0", "model-id-1", "model-id-2"]);
    expect(models.every((model) => model.provider === "lmstudio")).toBe(true);
    expect(models.every((model) => model.label === model.modelId)).toBe(true);
  });

  it("tolerates a bare array and skips entries without an id", () => {
    expect(normalizeOpenAiModelList([{ id: "a" }, { object: "model" }, null], "openai-compatible")).toEqual([
      { provider: "openai-compatible", modelId: "a", label: "a" },
    ]);
  });

  it("unknown shapes produce nothing", () => {
    expect(normalizeOpenAiModelList({ models: [] }, "lmstudio")).toEqual([]);
    expect(normalizeOpenAiModelList("nope", "lmstudio")).toEqual([]);
  });
});

describe("applyLmStudioContextLengths (documented /api/v0/models shape)", () => {
  it("enriches matching ids from the doc fixture and leaves unmatched models untouched", () => {
    const base = normalizeOpenAiModelList(parse(LMSTUDIO_V1_MODELS_FIXTURE), "lmstudio");
    const withUnknown = [...base, { provider: "lmstudio" as const, modelId: "not-in-v0", label: "not-in-v0" }];
    const enriched = applyLmStudioContextLengths(withUnknown, parse(LMSTUDIO_V0_MODELS_FIXTURE));
    expect(enriched.find((model) => model.modelId === "qwen2-vl-7b-instruct")?.contextLength).toBe(32768);
    expect(enriched.find((model) => model.modelId === "meta-llama-3.1-8b-instruct")?.contextLength).toBe(131072);
    expect(enriched.find((model) => model.modelId === "text-embedding-nomic-embed-text-v1.5")?.contextLength).toBe(2048);
    expect(enriched.find((model) => model.modelId === "not-in-v0")).not.toHaveProperty("contextLength");
  });

  it("never adds models and ignores unusable enrichment data", () => {
    const base = [{ provider: "lmstudio" as const, modelId: "a", label: "a" }];
    expect(applyLmStudioContextLengths(base, { data: [{ id: "b", max_context_length: 100 }] })).toEqual(base);
    expect(applyLmStudioContextLengths(base, null)).toBe(base);
    expect(applyLmStudioContextLengths(base, { data: [{ id: "a", max_context_length: -1 }] })).toEqual(base);
  });
});

describe("probes", () => {
  it("probeOllama parses the doc fixture end to end", async () => {
    const transport = new FakeTransport([
      { match: "127.0.0.1:11434/api/tags", handler: () => ok(parse(OLLAMA_TAGS_FIXTURE)) },
    ]);
    const source = await probeOllama(transport);
    expect(source.reachable).toBe(true);
    expect(source.models).toHaveLength(1);
    expect(source.models[0]?.modelId).toBe("deepseek-r1:latest");
    expect(source.error).toBeUndefined();
  });

  it("probeLmStudio merges /v1/models with best-effort /api/v0/models context lengths", async () => {
    const transport = new FakeTransport([
      { match: "127.0.0.1:1234/v1/models", handler: () => ok(parse(LMSTUDIO_V1_MODELS_FIXTURE)) },
      { match: "127.0.0.1:1234/api/v0/models", handler: () => ok(parse(LMSTUDIO_V0_MODELS_FIXTURE)) },
    ]);
    const source = await probeLmStudio(transport);
    expect(source.reachable).toBe(true);
    expect(source.models.map((model) => [model.modelId, model.contextLength])).toEqual([
      ["qwen2-vl-7b-instruct", 32768],
      ["meta-llama-3.1-8b-instruct", 131072],
      ["text-embedding-nomic-embed-text-v1.5", 2048],
    ]);
  });

  it("probeLmStudio still reports models when the enhanced endpoint is unavailable", async () => {
    const transport = new FakeTransport([
      { match: "/v1/models", handler: () => ok(parse(LMSTUDIO_V1_MODELS_FIXTURE)) },
      // /api/v0/models unrouted → network error → enrichment silently skipped.
    ]);
    const source = await probeLmStudio(transport);
    expect(source.models).toHaveLength(3);
    expect(source.models.every((model) => model.contextLength === undefined)).toBe(true);
  });

  it("nothing running is an honest empty result, not a fabricated list", async () => {
    const transport = new FakeTransport([]); // every URL unreachable
    const [ollama, lmstudio, extra] = await Promise.all([
      probeOllama(transport),
      probeLmStudio(transport),
      probeOpenAiCompatible(transport, "http://192.168.1.20:8000/v1"),
    ]);
    for (const source of [ollama, lmstudio, extra]) {
      expect(source.reachable).toBe(false);
      expect(source.models).toEqual([]);
    }
  });

  it("a reachable server with an unrecognized shape reports zero models plus an error note", async () => {
    const transport = new FakeTransport([
      { match: "/api/tags", handler: () => ok({ totally: "different" }) },
    ]);
    const source = await probeOllama(transport);
    expect(source.reachable).toBe(true);
    expect(source.models).toEqual([]);
    expect(source.error).toContain("documented /api/tags shape");
  });

  it("discoverLocalModels aggregates defaults + extra endpoints and flattens honestly", async () => {
    const transport = new FakeTransport([
      { match: "11434/api/tags", handler: () => ok(parse(OLLAMA_TAGS_FIXTURE)) },
      { match: "1234/v1/models", handler: () => ok({ object: "list", data: [] }) }, // running, empty
      { match: "workshop-pc:8000/v1/models", handler: () => ok(parse(OPENAI_MODELS_FIXTURE)) },
    ]);
    const discovery = await discoverLocalModels({
      transport,
      extraBaseUrls: ["http://workshop-pc:8000/v1", "not a url"],
      now: () => 12345,
    });
    expect(discovery.discoveredAt).toBe(12345);
    expect(discovery.sources).toHaveLength(3); // invalid extra URL dropped, not probed
    expect(discovery.models.map((model) => model.provider)).toEqual([
      "ollama",
      "openai-compatible",
      "openai-compatible",
      "openai-compatible",
    ]);
    const lmstudio = discovery.sources.find((source) => source.provider === "lmstudio");
    expect(lmstudio?.reachable).toBe(true);
    expect(lmstudio?.models).toEqual([]); // running with nothing installed: honest empty
    expect(lmstudio?.error).toBeUndefined();
  });
});
