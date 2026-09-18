import type {
  ChatAdapter,
  ChatCompletionResult,
  ChatMessage,
  ContextItem,
} from "./index";
import { buildVantageChatSystemPrompt } from "./chat-system-prompt";
import { ChatUpstreamTimeoutError, resolveChatFetchTimeoutMs } from "./chat-timeout";
import { redactFinanceTextForAi } from "./finance-redact";
import { ProviderRateLimitError, isProviderQuotaOrCapacityStatus } from "./http-chat-adapter";

/** Public HTTP generate endpoint documented by petals-infra/chat.petals.dev. */
export const PETALS_DEFAULT_GENERATE_URL = "https://chat.petals.dev/api/v1/generate";

/**
 * Swarm model that was healthy on health.petals.dev when this path shipped.
 * Override with PETALS_MODEL. Do not default to Llama-2-70b — that replica is
 * often marked broken.
 */
export const PETALS_DEFAULT_MODEL = "petals-team/StableBeluga2";

/** Keep prompts small: the volunteer swarm is slow (~few tok/s) and flaky. */
export const PETALS_MAX_PROMPT_CHARS = 8_000;
export const PETALS_MAX_NEW_TOKENS = 256;

const PRIVATE_CONTEXT_TYPES = new Set<ContextItem["type"]>(["private_memory"]);

/**
 * Last-resort public volunteer swarm. On unless PETALS_PUBLIC_POOL is 0/false/off.
 * Not a key, not a quota grant, not unlimited — peers go offline constantly.
 */
export function isPetalsPublicPoolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PETALS_PUBLIC_POOL?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

export function petalsGenerateUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PETALS_API_URL?.trim() || PETALS_DEFAULT_GENERATE_URL;
  const trimmed = raw.replace(/\/+$/, "");
  if (/\/api\//i.test(trimmed)) return trimmed;
  return `${trimmed}/api/v1/generate`;
}

export function petalsPublicModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.PETALS_MODEL?.trim() || PETALS_DEFAULT_MODEL;
}

export function tryCreatePetalsPublicAdapter(input?: {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
  timeoutMs?: number;
}): PetalsPublicPoolAdapter | null {
  const env = input?.env ?? process.env;
  if (!isPetalsPublicPoolEnabled(env)) return null;
  return new PetalsPublicPoolAdapter({
    generateUrl: petalsGenerateUrl(env),
    model: petalsPublicModel(env),
    capability: input?.capability ?? "chat",
    fetchImpl: input?.fetchImpl,
    timeoutMs: input?.timeoutMs,
  });
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function sanitizePetalsContext(items: ContextItem[]): ContextItem[] {
  return items
    .filter((item) => !PRIVATE_CONTEXT_TYPES.has(item.type))
    .map((item) => ({
      ...item,
      content: redactFinanceTextForAi(item.content),
    }));
}

export function buildPetalsPrompt(input: {
  capability?: string;
  message: string;
  context: ContextItem[];
  history?: ChatMessage[];
}): string {
  const system = buildVantageChatSystemPrompt({
    capability: input.capability,
    answerPath: "public_swarm",
  });
  const safeContext = sanitizePetalsContext(input.context);
  const parts = [system];
  for (const item of safeContext) {
    parts.push(`[${item.type}:${item.id}] ${item.content}`);
  }
  for (const turn of input.history ?? []) {
    const role = turn.role === "assistant" ? "Assistant" : "User";
    parts.push(`${role}: ${redactFinanceTextForAi(turn.content)}`);
  }
  parts.push(`User: ${redactFinanceTextForAi(input.message)}`);
  parts.push("Assistant:");
  const joined = parts.join("\n\n");
  if (joined.length <= PETALS_MAX_PROMPT_CHARS) return joined;
  return joined.slice(joined.length - PETALS_MAX_PROMPT_CHARS);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))) {
      throw new ChatUpstreamTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class PetalsPublicPoolAdapter implements ChatAdapter {
  readonly provider = "petals";
  readonly model: string;
  readonly supportsNativeTools = false;
  readonly generateUrl: string;
  private readonly capability: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(input: {
    generateUrl: string;
    model: string;
    capability: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.generateUrl = input.generateUrl;
    this.model = input.model;
    this.capability = input.capability;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? resolveChatFetchTimeoutMs(process.env.VANTAGE_CHAT_TIMEOUT_MS);
  }

  estimateCostUsd(): number {
    return 0;
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: ChatMessage[];
    promptCachingEnabled?: boolean;
  }): Promise<ChatCompletionResult> {
    const prompt = buildPetalsPrompt({
      capability: this.capability,
      message: input.message,
      context: input.context,
      history: input.history,
    });
    const body = new URLSearchParams({
      model: this.model,
      inputs: prompt,
      max_new_tokens: String(PETALS_MAX_NEW_TOKENS),
      do_sample: "1",
      temperature: "0.6",
      top_p: "0.9",
    });
    const response = await fetchWithTimeout(
      this.fetchImpl,
      this.generateUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      },
      this.timeoutMs,
    );
    if (!response.ok) {
      if (isProviderQuotaOrCapacityStatus(response.status)) {
        throw new ProviderRateLimitError(
          `Petals public swarm is at capacity (${response.status} model=${this.model})`,
          response.status,
        );
      }
      throw new Error(`Petals public swarm failed (${response.status} model=${this.model})`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      outputs?: string;
      traceback?: string;
    };
    if (payload.ok === false) {
      throw new ProviderRateLimitError(
        `Petals public swarm rejected the turn (model=${this.model})`,
        503,
      );
    }
    const text = (payload.outputs ?? "").trim();
    if (!text) {
      throw new ProviderRateLimitError("Petals public swarm returned an empty completion", 503);
    }
    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(text);
    return {
      text,
      promptTokens,
      completionTokens,
      costUsd: 0,
    };
  }
}
