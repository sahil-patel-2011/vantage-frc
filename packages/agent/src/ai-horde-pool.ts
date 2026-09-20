/**
 * AI Horde — a volunteer swarm that is actually running.
 *
 * Vantage's free path was the public Petals swarm, and on 2026-09-19 that
 * swarm was measured empty: `chat.petals.dev` registers one model and asking
 * for it returns `MissingBlocksError: No servers holding blocks [0..79] are
 * online`, while `health.petals.dev` refuses connections. Upstream's last
 * commit was September 2024. A free provider that cannot answer is not a free
 * provider.
 *
 * AI Horde is the same idea with people still in it. Measured the same day:
 * heartbeat OK, 37 text workers, 26 models, and an anonymous request for
 * `meta-llama/Llama-3.2-3B-Instruct` came back in eleven seconds. It is
 * crowdsourced, free, and needs no account — a registered key only buys
 * priority.
 *
 * ## Two things about this swarm that decide the whole design
 *
 * **Most of its capacity is not for us.** Of the 26 text models advertised,
 * the large ones are roleplay and deliberately-uncensored community builds —
 * "Forgotten-Safeword", "Judas-Uncensored", "…-heretic", "Nymphaea-RP". The
 * instruction-tuned general models a student product wants have one or two
 * workers each. So this asks for an explicit list of models and never for
 * "whatever is free": the Horde only dispatches a job to a worker hosting one
 * of the models named in the request, which makes the allowlist the safety
 * mechanism rather than a preference. There is no fallback to the rest of the
 * swarm, on purpose — no answer is better than an answer from a model chosen
 * to have no guardrails, in a product used by fourteen-year-olds.
 *
 * **Volunteers can read what you send.** A worker is somebody's GPU running
 * somebody's software; prompts and completions pass through it. That is the
 * same trade Petals asked for and it is why this is off unless a team turns it
 * on, and why private context is filtered out before the prompt is built.
 */

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

export const AI_HORDE_DEFAULT_BASE_URL = "https://aihorde.net/api/v2";

/** Anonymous access. Works, and is last in every queue. */
export const AI_HORDE_ANONYMOUS_KEY = "0000000000";

/**
 * The Horde asks every client to identify itself so a misbehaving one can be
 * spoken to rather than blocked.
 */
export const AI_HORDE_CLIENT_AGENT =
  "vantage-frc:0.2:https://github.com/sahil-patel-2011/vantage-frc";

/**
 * The models Vantage will accept an answer from, best first.
 *
 * Instruction-tuned general models only. This is an allowlist and not a
 * preference order with a fallback — see the note at the top of the file.
 * Every entry was confirmed present on the swarm on 2026-09-19; a model that
 * disappears costs availability, never correctness, because the Horde simply
 * has nothing to dispatch to.
 *
 * Three, because that is what fits in a selector without becoming a menu, and
 * because past three the instruction-tuned options on this swarm run out.
 */
export const AI_HORDE_MODELS = [
  {
    id: "meta-llama/Llama-3.2-3B-Instruct",
    label: "Llama 3.2 3B",
    note: "Best answers of the three. One or two volunteers host it, so it can be slow.",
  },
  {
    id: "koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M",
    label: "Llama 3.2 3B (compressed)",
    note: "The same model, quantised. More volunteers host it.",
  },
  {
    id: "koboldcpp/Llama-3.2-1B-Instruct",
    label: "Llama 3.2 1B",
    note: "Fastest and weakest. Fine for short questions.",
  },
] as const;

export type AiHordeModelId = (typeof AI_HORDE_MODELS)[number]["id"];

export const AI_HORDE_MODEL_IDS: readonly string[] = AI_HORDE_MODELS.map((row) => row.id);

/** True when `model` is one Vantage will accept from this swarm. */
export function isAiHordeModel(model: string | null | undefined): model is AiHordeModelId {
  return typeof model === "string" && AI_HORDE_MODEL_IDS.includes(model);
}

/**
 * Small on purpose. These are 1B–3B models on volunteer hardware: a long
 * prompt is slower and worse, not slower and better.
 */
export const AI_HORDE_MAX_PROMPT_CHARS = 6_000;
export const AI_HORDE_MAX_NEW_TOKENS = 300;
export const AI_HORDE_MAX_CONTEXT = 4_096;

/**
 * Where the answer ends.
 *
 * The prompt is a transcript — context blocks as `[type:id] …`, then `User:`,
 * then `Assistant:` — and a 3B model on volunteer hardware does not reliably
 * stop after its turn. Measured against the live swarm: it answered the
 * question in one sentence and then carried on, reproducing the context block
 * verbatim, including a `strategy.private_edge` fact. A student would have
 * seen their team's internal notes pasted under the reply.
 *
 * These are sent as stop sequences so generation ends at the boundary, and
 * `trimAiHordeCompletion` cuts anything that arrives anyway — a volunteer's
 * backend may not honour them, and "the worker was supposed to stop" is not a
 * thing to rely on when the cost of being wrong is leaking context.
 */
export const AI_HORDE_STOP_SEQUENCES = [
  "\nUser:",
  "\nAssistant:",
  "\n[module_",
  "\n[private_",
  "\n[team_",
  "\n[chat_",
  "\n[artifact:",
  "\n[task:",
];

/** How long to wait for a volunteer before giving up. */
export const AI_HORDE_POLL_INTERVAL_MS = 2_500;
export const AI_HORDE_DEFAULT_WAIT_MS = 120_000;

const PRIVATE_CONTEXT_TYPES = new Set<ContextItem["type"]>(["private_memory"]);

/** Off unless a team turns it on. See the note at the top of the file. */
export function isAiHordeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AI_HORDE_POOL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export function aiHordeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.AI_HORDE_BASE_URL?.trim() || AI_HORDE_DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * A registered key if the deployment has one, anonymous otherwise.
 *
 * The difference is queue position, not capability. Anonymous requests are
 * served after everybody who has earned kudos, which on a busy evening is the
 * difference between eleven seconds and a timeout.
 */
export function aiHordeApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_HORDE_API_KEY?.trim() || AI_HORDE_ANONYMOUS_KEY;
}

/**
 * The models to ask for, narrowed to one when a team has chosen.
 *
 * An unknown or absent choice means all three rather than an error: the
 * choice is a preference, and the allowlist is the rule.
 */
export function aiHordeRequestModels(chosen?: string | null): string[] {
  return isAiHordeModel(chosen) ? [chosen] : [...AI_HORDE_MODEL_IDS];
}

/**
 * The answer, and nothing the model copied from its own prompt.
 *
 * Cuts at the first transcript or context marker. See the note on
 * `AI_HORDE_STOP_SEQUENCES` for why this exists as well as them rather than
 * instead of them.
 */
export function trimAiHordeCompletion(raw: string): string {
  let cut = raw;
  for (const marker of AI_HORDE_STOP_SEQUENCES) {
    const at = cut.indexOf(marker);
    if (at !== -1) cut = cut.slice(0, at);
  }
  // A completion that opens with a context block has no answer in it at all;
  // an empty string reads as a fault, which is what it is.
  if (/^\s*\[(?:module_|private_|team_|chat_|artifact:|task:)/.test(cut)) return "";
  return cut.trim();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Private context never leaves for a volunteer's machine. */
export function sanitizeAiHordeContext(items: ContextItem[]): ContextItem[] {
  return items
    .filter((item) => !PRIVATE_CONTEXT_TYPES.has(item.type))
    .map((item) => ({ ...item, content: redactFinanceTextForAi(item.content) }));
}

export function buildAiHordePrompt(input: {
  capability?: string;
  message: string;
  context: ContextItem[];
  history?: ChatMessage[];
}): string {
  const system = buildVantageChatSystemPrompt({
    capability: input.capability,
    answerPath: "public_swarm",
  });
  const parts = [system];
  for (const item of sanitizeAiHordeContext(input.context)) {
    parts.push(`[${item.type}:${item.id}] ${item.content}`);
  }
  for (const turn of input.history ?? []) {
    parts.push(`${turn.role === "assistant" ? "Assistant" : "User"}: ${redactFinanceTextForAi(turn.content)}`);
  }
  parts.push(`User: ${redactFinanceTextForAi(input.message)}`);
  parts.push("Assistant:");
  const joined = parts.join("\n\n");
  // Keeps the end — the question — rather than the start, which is the
  // system prompt this file also controls.
  return joined.length <= AI_HORDE_MAX_PROMPT_CHARS
    ? joined
    : joined.slice(joined.length - AI_HORDE_MAX_PROMPT_CHARS);
}

/**
 * What to tell somebody when the swarm says no.
 *
 * Each of these is a different problem with a different answer, and the
 * difference matters on a competition day: waiting helps for one of them and
 * is wasted on the rest.
 */
export function aiHordeFailureMessage(kind: "empty" | "faulted" | "timeout" | "rejected", detail?: string): string {
  switch (kind) {
    case "empty":
      return "No volunteer on the AI Horde is hosting one of the models Vantage accepts right now. This is the swarm being empty rather than busy, so waiting will not help — add a provider key under Team → AI keys, or point Vantage at Ollama or LM Studio on your own machine.";
    case "faulted":
      return "A volunteer picked up the request and then failed part way through. Asking again usually lands on a different machine.";
    case "timeout":
      return "No volunteer finished the request in time. The Horde serves anonymous requests last; a free AI Horde key raises the priority, and a provider key removes the queue entirely.";
    case "rejected":
      return `The AI Horde refused the request${detail ? `: ${detail}` : ""}.`;
  }
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

type HordeSubmit = { id?: string; message?: string; errors?: Record<string, string> };
type HordeStatus = {
  done?: boolean;
  faulted?: boolean;
  is_possible?: boolean;
  wait_time?: number;
  queue_position?: number;
  generations?: Array<{ text?: string; model?: string; worker_name?: string }>;
};

export class AiHordeAdapter implements ChatAdapter {
  readonly provider = "ai_horde";
  /**
   * Not readonly, deliberately.
   *
   * When the swarm is asked for all three it picks whichever volunteer is
   * free, so the model that answered is only known afterwards. The billing
   * receipt reads this field after `complete()` resolves, so writing the real
   * one here is what puts the machine's answer in the usage ledger instead of
   * our guess. The interface declares it readonly, which stops anybody
   * outside from doing the same.
   */
  model: string;
  readonly supportsNativeTools = false;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly capability: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly requestModels: string[];

  constructor(input: {
    baseUrl: string;
    apiKey: string;
    capability: string;
    /** A chosen model, or null for all three. */
    model?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    waitMs?: number;
    pollMs?: number;
  }) {
    this.baseUrl = input.baseUrl;
    this.apiKey = input.apiKey;
    this.capability = input.capability;
    this.requestModels = aiHordeRequestModels(input.model);
    // The reported model is the chosen one, or the list's first when the
    // swarm will pick. The completion overwrites it with what actually ran,
    // so the usage ledger records the machine's answer rather than our guess.
    this.model = isAiHordeModel(input.model) ? input.model : AI_HORDE_MODEL_IDS[0]!;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.timeoutMs = input.timeoutMs ?? resolveChatFetchTimeoutMs(process.env.VANTAGE_CHAT_TIMEOUT_MS);
    this.waitMs = input.waitMs ?? AI_HORDE_DEFAULT_WAIT_MS;
    this.pollMs = input.pollMs ?? AI_HORDE_POLL_INTERVAL_MS;
  }

  /** Volunteer time. It costs the team nothing, and the ledger says so. */
  estimateCostUsd(): number {
    return 0;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json",
      apikey: this.apiKey,
      "Client-Agent": AI_HORDE_CLIENT_AGENT,
    };
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: ChatMessage[];
  }): Promise<ChatCompletionResult> {
    const prompt = buildAiHordePrompt({
      capability: this.capability,
      message: input.message,
      context: input.context,
      history: input.history,
    });

    const submitted = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/generate/text/async`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          prompt,
          params: {
            max_context_length: AI_HORDE_MAX_CONTEXT,
            max_length: AI_HORDE_MAX_NEW_TOKENS,
            temperature: 0.6,
            top_p: 0.9,
            stop_sequence: AI_HORDE_STOP_SEQUENCES,
          },
          models: this.requestModels,
        }),
      },
      this.timeoutMs,
    );

    if (!submitted.ok) {
      const detail = await submitted.text().catch(() => "");
      if (isProviderQuotaOrCapacityStatus(submitted.status)) {
        throw new ProviderRateLimitError(aiHordeFailureMessage("timeout"), submitted.status);
      }
      throw new ProviderRateLimitError(
        aiHordeFailureMessage("rejected", detail.slice(0, 200)),
        submitted.status,
      );
    }

    const job = (await submitted.json()) as HordeSubmit;
    if (!job.id) {
      throw new ProviderRateLimitError(aiHordeFailureMessage("rejected", job.message), 503);
    }

    const deadline = Date.now() + this.waitMs;
    let sawPossible = true;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      const check = await fetchWithTimeout(
        this.fetchImpl,
        `${this.baseUrl}/generate/text/status/${job.id}`,
        { method: "GET", headers: this.headers() },
        this.timeoutMs,
      );
      if (!check.ok) continue;
      const status = (await check.json()) as HordeStatus;

      // `is_possible: false` means no online worker hosts any model asked
      // for. That is the empty-swarm case, and it will not resolve itself.
      if (status.is_possible === false) sawPossible = false;
      if (status.faulted) throw new ProviderRateLimitError(aiHordeFailureMessage("faulted"), 503);
      if (!status.done) {
        if (!sawPossible) {
          await this.cancel(job.id);
          throw new ProviderRateLimitError(aiHordeFailureMessage("empty"), 503);
        }
        continue;
      }

      const generation = status.generations?.[0];
      const text = trimAiHordeCompletion(generation?.text ?? "");
      if (!text) throw new ProviderRateLimitError(aiHordeFailureMessage("faulted"), 503);
      // What actually ran, before the receipt is taken.
      if (isAiHordeModel(generation?.model)) this.model = generation.model;
      return {
        text,
        promptTokens: estimateTokens(prompt),
        completionTokens: estimateTokens(text),
        costUsd: 0,
      };
    }

    // Nobody took it. Let the volunteers have their queue slot back.
    await this.cancel(job.id);
    throw new ProviderRateLimitError(aiHordeFailureMessage("timeout"), 504);
  }

  /** Best-effort: a job we have stopped waiting for should not stay queued. */
  private async cancel(id: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/generate/text/status/${id}`, {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch {
      // The swarm expires abandoned jobs on its own; this only makes it sooner.
    }
  }
}

export function tryCreateAiHordeAdapter(input?: {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
  model?: string | null;
  timeoutMs?: number;
  waitMs?: number;
}): AiHordeAdapter | null {
  const env = input?.env ?? process.env;
  if (!isAiHordeEnabled(env)) return null;
  return new AiHordeAdapter({
    baseUrl: aiHordeBaseUrl(env),
    apiKey: aiHordeApiKey(env),
    capability: input?.capability ?? "chat",
    model: input?.model ?? env.AI_HORDE_MODEL?.trim() ?? null,
    fetchImpl: input?.fetchImpl,
    timeoutMs: input?.timeoutMs,
    waitMs: input?.waitMs,
  });
}
