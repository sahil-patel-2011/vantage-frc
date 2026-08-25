import type {
  CapabilityContext,
  CapabilityDetection,
  CapabilityReport,
  ConnectorCapability,
} from "./capability.js";
import type { JsonHttpTransport } from "./ports.js";

/**
 * local-models capability — discover model servers running on THIS machine and report the
 * real model list upward. The hosted web app runs on Vercel and physically cannot reach a
 * member's localhost, so discovery has to happen here and travel up in the heartbeat.
 *
 * Probed endpoints and response shapes (verified against the official docs — do not guess):
 *
 *  - Ollama `GET http://127.0.0.1:11434/api/tags`
 *    https://github.com/ollama/ollama/blob/main/docs/api.md ("List Local Models"):
 *      { "models": [ { "name", "model", "modified_at", "size", "digest",
 *        "details": { "parent_model", "format", "family", "families",
 *                     "parameter_size", "quantization_level" } } ] }
 *    `size` is the model size in bytes. No context length in this response — so none is
 *    reported (never invented).
 *
 *  - LM Studio `GET http://127.0.0.1:1234/v1/models` (OpenAI-compatible)
 *    https://lmstudio.ai/docs/developer/openai-compat/models documents the endpoint as
 *    OpenAI-compatible; the response shape is OpenAI's ListModelsResponse
 *    (https://github.com/openai/openai-openapi → openapi.yaml):
 *      { "object": "list", "data": [ { "id", "object": "model", "created", "owned_by" } ] }
 *    That shape carries no context length or size. LM Studio's own REST API
 *    (`GET /api/v0/models`, https://lmstudio.ai/docs/developer/rest/endpoints) DOES:
 *      { "object": "list", "data": [ { "id", "object": "model", "type", "publisher",
 *        "arch", "compatibility_type", "quantization", "state", "max_context_length" } ] }
 *    with the same ids as /v1/models — so after a successful /v1/models probe we make one
 *    best-effort enrichment call and merge `max_context_length` by id. If that call fails
 *    (older build, bearer-token-protected server), models are reported without context
 *    length rather than with a guessed one.
 *
 *  - Any extra user-configured OpenAI-compatible base URLs (`<base>/models`), normalized
 *    with the same ListModelsResponse rules.
 *
 * Honesty: nothing running → `reachable: false` with zero models. A reachable server
 * answering an unrecognized shape → zero models plus an error note. Model lists are never
 * fabricated, padded, or defaulted.
 */

export type LocalModelProvider = "ollama" | "lmstudio" | "openai-compatible";

export type LocalModel = {
  provider: LocalModelProvider;
  /** The identifier requests must use (Ollama `model`, OpenAI-compatible `id`). */
  modelId: string;
  /** Human-readable label; equals modelId when the server offers nothing better. */
  label: string;
  /** Max context tokens — only when the server actually reported it. */
  contextLength?: number;
  /** On-disk size in bytes — only when the server actually reported it. */
  sizeBytes?: number;
};

export type LocalModelSource = {
  provider: LocalModelProvider;
  baseUrl: string;
  reachable: boolean;
  models: LocalModel[];
  /** Present when the server answered but not in a shape we recognize. */
  error?: string;
};

export const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
export const LOCAL_MODEL_PROBE_TIMEOUT_MS = 2_000;
export const LOCAL_MODEL_RESCAN_INTERVAL_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Pure normalizers (fixture-tested against the documented responses)  */
/* ------------------------------------------------------------------ */

/** Normalize an Ollama /api/tags body. Unknown shapes → empty list, never a guess. */
export function normalizeOllamaTags(body: unknown): LocalModel[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  const out: LocalModel[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const modelId =
      typeof record.model === "string" && record.model
        ? record.model
        : typeof record.name === "string" && record.name
          ? record.name
          : null;
    if (!modelId) continue;
    const label = typeof record.name === "string" && record.name ? record.name : modelId;
    const size = record.size;
    out.push({
      provider: "ollama",
      modelId,
      label,
      ...(typeof size === "number" && Number.isFinite(size) && size >= 0 ? { sizeBytes: size } : {}),
    });
  }
  return out;
}

/**
 * Normalize an OpenAI-compatible /v1/models body (ListModelsResponse). Accepts the
 * documented `{ object: "list", data: [...] }` and tolerates a bare array. Entries
 * without a string `id` are skipped — an id is the one thing a caller cannot do without.
 */
export function normalizeOpenAiModelList(body: unknown, provider: LocalModelProvider): LocalModel[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : null;
  if (!list) return [];
  const out: LocalModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id ? record.id : null;
    if (!id) continue;
    out.push({ provider, modelId: id, label: id });
  }
  return out;
}

/**
 * Merge LM Studio /api/v0/models `max_context_length` into already-normalized models,
 * matching by id. Enrich-only: never adds models, never invents a value for ids the
 * enhanced endpoint did not report.
 */
export function applyLmStudioContextLengths(models: LocalModel[], v0Body: unknown): LocalModel[] {
  const list =
    v0Body && typeof v0Body === "object" && Array.isArray((v0Body as Record<string, unknown>).data)
      ? ((v0Body as Record<string, unknown>).data as unknown[])
      : null;
  if (!list) return models;
  const contextById = new Map<string, number>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id === "string" &&
      record.id &&
      typeof record.max_context_length === "number" &&
      Number.isFinite(record.max_context_length) &&
      record.max_context_length > 0
    ) {
      contextById.set(record.id, record.max_context_length);
    }
  }
  if (contextById.size === 0) return models;
  return models.map((model) => {
    const contextLength = contextById.get(model.modelId);
    return contextLength === undefined ? model : { ...model, contextLength };
  });
}

/* ------------------------------------------------------------------ */
/* Probing                                                             */
/* ------------------------------------------------------------------ */

async function probe(
  transport: JsonHttpTransport,
  url: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reachable: boolean; error: string }> {
  try {
    const response = await transport.getJson(url, { timeoutMs: LOCAL_MODEL_PROBE_TIMEOUT_MS });
    if (!response.ok) return { ok: false, reachable: true, error: `HTTP ${response.status}` };
    return { ok: true, body: response.data };
  } catch (error) {
    return { ok: false, reachable: false, error: error instanceof Error ? error.message : "unreachable" };
  }
}

export async function probeOllama(
  transport: JsonHttpTransport,
  baseUrl = OLLAMA_BASE_URL,
): Promise<LocalModelSource> {
  const result = await probe(transport, new URL("/api/tags", baseUrl).toString());
  if (!result.ok) {
    return { provider: "ollama", baseUrl, reachable: result.reachable, models: [], error: result.error };
  }
  const models = normalizeOllamaTags(result.body);
  return {
    provider: "ollama",
    baseUrl,
    reachable: true,
    models,
    ...(models.length === 0 && !Array.isArray(result.body.models)
      ? { error: "Server answered but not in the documented /api/tags shape." }
      : {}),
  };
}

export async function probeLmStudio(
  transport: JsonHttpTransport,
  baseUrl = LM_STUDIO_BASE_URL,
): Promise<LocalModelSource> {
  const result = await probe(transport, new URL("/v1/models", baseUrl).toString());
  if (!result.ok) {
    return { provider: "lmstudio", baseUrl, reachable: result.reachable, models: [], error: result.error };
  }
  let models = normalizeOpenAiModelList(result.body, "lmstudio");
  const malformed = models.length === 0 && !Array.isArray(result.body.data);
  if (models.length > 0) {
    // Best-effort context-length enrichment from LM Studio's own REST API (see header).
    const enhanced = await probe(transport, new URL("/api/v0/models", baseUrl).toString());
    if (enhanced.ok) models = applyLmStudioContextLengths(models, enhanced.body);
  }
  return {
    provider: "lmstudio",
    baseUrl,
    reachable: true,
    models,
    ...(malformed ? { error: "Server answered but not in the OpenAI-compatible /v1/models shape." } : {}),
  };
}

export async function probeOpenAiCompatible(
  transport: JsonHttpTransport,
  baseUrl: string,
): Promise<LocalModelSource> {
  // A configured base URL may or may not include /v1 — resolve `models` under it.
  const trimmed = baseUrl.replace(/\/+$/, "");
  const result = await probe(transport, `${trimmed}/models`);
  if (!result.ok) {
    return { provider: "openai-compatible", baseUrl, reachable: result.reachable, models: [], error: result.error };
  }
  const models = normalizeOpenAiModelList(result.body, "openai-compatible");
  return {
    provider: "openai-compatible",
    baseUrl,
    reachable: true,
    models,
    ...(models.length === 0 && !Array.isArray(result.body.data)
      ? { error: "Server answered but not in the OpenAI-compatible /v1/models shape." }
      : {}),
  };
}

export type LocalModelDiscovery = {
  sources: LocalModelSource[];
  models: LocalModel[];
  discoveredAt: number;
};

export async function discoverLocalModels(options: {
  transport: JsonHttpTransport;
  extraBaseUrls?: string[];
  now?: () => number;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
}): Promise<LocalModelDiscovery> {
  const extras = (options.extraBaseUrls ?? []).filter((url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });
  const sources = await Promise.all([
    probeOllama(options.transport, options.ollamaBaseUrl),
    probeLmStudio(options.transport, options.lmStudioBaseUrl),
    ...extras.map((url) => probeOpenAiCompatible(options.transport, url)),
  ]);
  return {
    sources,
    models: sources.flatMap((source) => source.models),
    discoveredAt: (options.now ?? Date.now)(),
  };
}

/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */

export class LocalModelsCapability implements ConnectorCapability {
  readonly id = "local-models" as const;
  readonly label = "Local model discovery";

  private latest: LocalModelDiscovery | null = null;

  constructor(private readonly options: { rescanIntervalMs?: number } = {}) {}

  async detect(ctx: CapabilityContext): Promise<CapabilityDetection> {
    const extras = ctx.config.localModels?.extraBaseUrls ?? [];
    return {
      available: true, // probing localhost is always possible; results say what was found
      detail: `Probes Ollama (${OLLAMA_BASE_URL}), LM Studio (${LM_STUDIO_BASE_URL})${
        extras.length ? ` and ${extras.length} configured endpoint(s)` : ""
      }.`,
      data: { extraBaseUrls: extras },
    };
  }

  async start(ctx: CapabilityContext): Promise<void> {
    const interval = this.options.rescanIntervalMs ?? LOCAL_MODEL_RESCAN_INTERVAL_MS;
    while (!ctx.signal.aborted) {
      this.latest = await discoverLocalModels({
        transport: ctx.transport,
        extraBaseUrls: ctx.config.localModels?.extraBaseUrls,
        now: () => ctx.clock.now(),
      });
      const reachable = this.latest.sources.filter((source) => source.reachable);
      ctx.log(
        `local-models: ${this.latest.models.length} model(s) across ${reachable.length} reachable server(s).`,
      );
      await ctx.clock.sleep(interval, ctx.signal);
    }
  }

  async stop(): Promise<void> {
    // Nothing beyond signal abortion to release.
  }

  status(): CapabilityReport {
    if (!this.latest) {
      return { detail: "No scan has completed yet.", data: { models: [], sources: [] } };
    }
    const reachable = this.latest.sources.filter((source) => source.reachable);
    return {
      detail:
        this.latest.models.length === 0
          ? reachable.length === 0
            ? "No local model servers are running."
            : "Local model server(s) reachable, but no models are installed."
          : `${this.latest.models.length} local model(s) available.`,
      data: {
        models: this.latest.models,
        sources: this.latest.sources,
        discoveredAt: this.latest.discoveredAt,
      },
    };
  }
}
