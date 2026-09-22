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
 * Say which kind of "no" the swarm gave, because they need different answers.
 *
 * The public swarm returns HTTP 200 with `ok:false` and a Python traceback for
 * every failure, so without reading it a team that turned this on sees the
 * same opaque message whether the swarm is busy or whether nobody is hosting
 * the model at all.
 *
 * As measured on 2026-09-19, the second is the live case: `chat.petals.dev`
 * has only `petals-team/StableBeluga2` registered, and asking for it returns
 * `MissingBlocksError: No servers holding blocks [0..79] are online`. The
 * health monitor at health.petals.dev refuses connections. A volunteer swarm
 * with no volunteers is empty rather than slow, and telling somebody to wait
 * for capacity that does not exist wastes their competition day.
 */
export function petalsFailureMessage(traceback: string | undefined, model: string): string {
  const text = traceback ?? "";
  if (text.includes("MissingBlocksError") || text.includes("No servers holding blocks")) {
    return `No volunteer is hosting ${model} on the public Petals swarm right now, so it cannot answer. This is the swarm being empty rather than busy — waiting will not help. Add a provider key under Team → AI keys, or point Vantage at Ollama or LM Studio on your own machine.`;
  }
  if (/KeyError/.test(text)) {
    return `The public Petals swarm does not serve ${model}. Set PETALS_MODEL to a model it actually hosts, or use a provider key instead.`;
  }
  return `The public Petals swarm could not answer with ${model}. It is volunteer-run and often unavailable; a provider key or a local model is the reliable path.`;
}

/**
 * Last-resort public volunteer swarm. **Off unless PETALS_PUBLIC_POOL is
 * explicitly turned on**, and deliberately so.
 *
 * Petals' own documentation says not to use the public swarm for confidential
 * data: the peers serving the model layers can recover the input and the
 * output, and can alter the output on the way back. They also see your IP.
 *
 * Vantage is a closed, invite-only platform holding student names, team
 * strategy and pick lists, and sponsor contacts. Sending any of that to
 * anonymous volunteer GPUs is a decision a team has to make on purpose, with
 * the trade in front of them — it is not something a missing API key should
 * silently opt them into, which is what defaulting this to on did.
 *
 * Turning it on is still reasonable for a team that wants free AI and is
 * only asking it about public match data. That is their call to make.
 */
export function isPetalsPublicPoolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PETALS_PUBLIC_POOL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
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
      throw new ProviderRateLimitError(petalsFailureMessage(payload.traceback, this.model), 503);
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
