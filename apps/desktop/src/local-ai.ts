/**
 * Local AI (experimental): a small model running on this computer in LM Studio, answering
 * Vantage's AI requests through the same personal bridge the Claude/Codex CLIs use.
 *
 * LM Studio serves an OpenAI-compatible API on http://127.0.0.1:1234/v1 once its local server
 * is on (Developer → Start server). This file is the pure half: requirement checks, reading
 * LM Studio's model list, picking the model, and one chat call. Electron and the network loop
 * live in local-ai-service.ts.
 */

/** 16 GB of memory: a ~9B model at 4-bit needs ~6 GB, plus the OS, LM Studio and Vantage. */
export const MIN_RAM_BYTES = 16 * 1024 ** 3;
/** 15 GB free disk for the model file, LM Studio's runtime and room to swap models. */
export const MIN_FREE_DISK_BYTES = 15 * 1000 ** 3;
export const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234/v1";

/**
 * Systems report a little under the marketed size (a "16 GB" laptop shows ~15.8 GiB after the
 * GPU's share), so allow 4% slack rather than refuse the very machines the bar is meant for.
 */
const RAM_SLACK = 0.96;

export type RequirementReport = {
  ok: boolean;
  ramGb: number;
  freeDiskGb: number;
  problems: string[];
};

export function checkLocalAiRequirements(input: { totalMemBytes: number; freeDiskBytes: number | null }): RequirementReport {
  const ramGb = Math.round((input.totalMemBytes / 1024 ** 3) * 10) / 10;
  const freeDiskGb = input.freeDiskBytes == null ? -1 : Math.round((input.freeDiskBytes / 1000 ** 3) * 10) / 10;
  const problems: string[] = [];
  if (input.totalMemBytes < MIN_RAM_BYTES * RAM_SLACK) {
    problems.push(`Local AI needs at least 16 GB of memory; this computer has ${ramGb} GB.`);
  }
  if (input.freeDiskBytes != null && input.freeDiskBytes < MIN_FREE_DISK_BYTES) {
    problems.push(`Local AI needs at least 15 GB of free disk space; ${freeDiskGb} GB is free.`);
  }
  return { ok: problems.length === 0, ramGb, freeDiskGb, problems };
}

/** Only loopback: the model server must be on this computer, never a LAN or internet host. */
export function sanitizeLocalModelUrl(raw: string | null | undefined): string {
  const fallback = DEFAULT_LM_STUDIO_URL;
  if (!raw) return fallback;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) return fallback;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path.endsWith("/v1") ? path : `${path}/v1`}`;
  } catch {
    return fallback;
  }
}

/** Model ids from an OpenAI-style `GET /v1/models` answer; embedding models are left out. */
export function parseModelList(json: unknown): string[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .filter((id) => !/embed/i.test(id));
}

/** The saved choice when LM Studio still has it, else a Qwen model, else the first one. */
export function pickLocalModel(models: readonly string[], preferred: string | null | undefined): string | null {
  if (preferred && models.includes(preferred)) return preferred;
  return models.find((id) => /qwen/i.test(id)) ?? models[0] ?? null;
}

/** Qwen's reasoning models print their thinking in <think>…</think>; Vantage wants the answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

export type LocalChatResult =
  | { ok: true; text: string; model: string; usage: { inputTokens: number; outputTokens: number } | null }
  | { ok: false; errorClass: "local_model_unavailable" | "timeout" | "cli_error"; errorMessage: string };

/** One prompt to the local model. The bridge job carries the whole conversation as one prompt. */
export async function localChat(options: {
  fetcher: typeof fetch;
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<LocalChatResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? anyOf([options.signal, timeout]) : timeout;
  try {
    const response = await options.fetcher(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: options.prompt }],
        temperature: 0.4,
        stream: false,
      }),
      signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        errorClass: response.status === 404 ? "local_model_unavailable" : "cli_error",
        errorMessage: `LM Studio answered ${response.status}. Check that the model is loaded.`,
      };
    }
    const json = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = stripReasoning(json.choices?.[0]?.message?.content ?? "");
    if (!text) return { ok: false, errorClass: "cli_error", errorMessage: "The local model returned an empty answer." };
    return {
      ok: true,
      text,
      model: json.model ?? options.model,
      usage: json.usage
        ? { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 }
        : null,
    };
  } catch (error) {
    if (timeout.aborted) return { ok: false, errorClass: "timeout", errorMessage: "The local model took too long to answer." };
    if (options.signal?.aborted) return { ok: false, errorClass: "cli_error", errorMessage: "The request was cancelled." };
    return {
      ok: false,
      errorClass: "local_model_unavailable",
      errorMessage: `LM Studio isn't answering (${error instanceof Error ? error.message : "no connection"}). Start its local server.`,
    };
  }
}

function anyOf(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === "function") return native.call(AbortSignal, signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** The saved settings, as written to disk. */
export type StoredLocalAiConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string | null;
  deviceId: string | null;
  orgId: string | null;
  userId: string | null;
  /** The device token sealed by the OS keychain, when one is available. */
  deviceTokenSealed?: string;
  /** Only when no keychain exists on this computer. */
  deviceToken?: string | null;
};

type LocalAiFields = {
  enabled: boolean;
  baseUrl: string;
  model: string | null;
  deviceToken: string | null;
  deviceId: string | null;
  orgId: string | null;
  userId: string | null;
};

/**
 * Settings → disk. Every field is listed: spreading what was read back in once carried an old
 * sealed token past an unpair, and the next launch restored the dropped pairing.
 */
export function sealLocalAiConfig(config: LocalAiFields, seal: ((value: string) => string) | null): StoredLocalAiConfig {
  const stored: StoredLocalAiConfig = {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    deviceId: config.deviceId,
    orgId: config.orgId,
    userId: config.userId,
  };
  if (config.deviceToken) {
    if (seal) stored.deviceTokenSealed = seal(config.deviceToken);
    else stored.deviceToken = config.deviceToken;
  }
  return stored;
}

/** Disk → settings; a token that no longer unseals (another user, a new keychain) is dropped. */
export function unsealLocalAiConfig(raw: unknown, unseal: ((sealed: string) => string) | null): Partial<LocalAiFields> {
  if (!raw || typeof raw !== "object") return {};
  const stored = raw as Partial<StoredLocalAiConfig>;
  let deviceToken: string | null = typeof stored.deviceToken === "string" ? stored.deviceToken : null;
  if (typeof stored.deviceTokenSealed === "string") {
    try {
      deviceToken = unseal ? unseal(stored.deviceTokenSealed) : null;
    } catch {
      deviceToken = null;
    }
  }
  return {
    enabled: stored.enabled === true,
    baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : undefined,
    model: typeof stored.model === "string" ? stored.model : null,
    deviceId: typeof stored.deviceId === "string" ? stored.deviceId : null,
    orgId: typeof stored.orgId === "string" ? stored.orgId : null,
    userId: typeof stored.userId === "string" ? stored.userId : null,
    deviceToken,
  };
}

/** What the bridge heartbeat reports for this engine (the server reads `available`). */
export function localEngineReport(input: { reachable: boolean; model: string | null; enabled: boolean }) {
  return {
    lmstudio: {
      available: input.enabled && input.reachable && Boolean(input.model),
      model: input.model,
      version: "lm-studio",
    },
  };
}
