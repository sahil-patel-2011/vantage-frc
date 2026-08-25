/**
 * Subscription-bridge chat adapter: executes a chat turn through a paired team member's
 * own Claude Pro/Max (Claude Code CLI) or ChatGPT (Codex CLI) subscription running on
 * their machine — $0 API cost to the team. The web side enqueues an ai_bridge_jobs row
 * (via an injected transport on a committed, non-RLS-transaction connection so the device
 * poller can see it) and polls server-side, bounded, for the result.
 *
 * Fallback contract: when construction includes a `fallback` adapter (or a lazy
 * `fallbackFactory`), any bridge failure (offline mid-job, timeout, CLI error, provider
 * rate limit, transport/infrastructure error) falls through to it and the degraded reason
 * is recorded on `lastDegraded` — surfaces read it after complete() to say honestly what
 * answered, and `provider`/`model` report whoever actually answered. Without a fallback,
 * failures throw with the provider's rate-limit text verbatim when present.
 */
import type { ChatAdapter, ContextItem } from "./index";

export type BridgeDegradedReason = "bridge-offline" | "bridge-timeout" | "bridge-rate-limited";

export type BridgeJobStatus = {
  state: "queued" | "leased" | "done" | "failed" | "expired";
  result?: {
    text?: string;
    model?: string | null;
    engine?: string | null;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number } | null;
  } | null;
  errorClass?: string | null;
  errorMessage?: string | null;
};

/**
 * DB port for the bridge queue. Implemented in apps/web/lib/ai-bridge/transport.ts over
 * the pairing pool (NOT the request's RLS transaction — an uncommitted insert would be
 * invisible to the device's claim function on its own connection).
 */
export type SubscriptionBridgeTransport = {
  enqueue(input: {
    orgId: string;
    userId: string | null;
    feature: string;
    prompt: string;
    requestedEngine: "claude" | "codex" | null;
    /** Per-job CLI budget the device should honor (clamped device-side too). */
    timeoutMs: number;
  }): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<BridgeJobStatus>;
  /** Best-effort: mark a still-queued job expired when the web caller gives up. */
  abandon(jobId: string): Promise<void>;
};

export class SubscriptionBridgeError extends Error {
  constructor(
    message: string,
    readonly degraded: BridgeDegradedReason,
    readonly errorClass: string | null = null,
  ) {
    super(message);
    this.name = "SubscriptionBridgeError";
  }
}

/** Max characters of the assembled prompt document (jsonb column is capped at 256KB). */
export const BRIDGE_PROMPT_MAX_CHARS = 180_000;

/**
 * Assemble the single prompt document the CLI receives: system framing, then each
 * context item clearly delimited, then the user message. Context is truncated first
 * (oldest/least important last in the caller's ordering) so the user message always fits.
 */
export function buildBridgePromptDocument(input: {
  message: string;
  context: ContextItem[];
  systemPrompt?: string;
}): string {
  const system =
    input.systemPrompt?.trim() ||
    "You are the AI assistant for a FIRST Robotics Competition team using Vantage. " +
      "Answer the user's message directly in plain text. Use only the team context provided " +
      "below — do not invent data the context does not contain, and say so when it is missing.";
  const message = input.message.slice(0, 40_000);
  const header = `=== SYSTEM ===\n${system}\n`;
  const footer = `\n=== USER MESSAGE ===\n${message}\n`;
  let budget = BRIDGE_PROMPT_MAX_CHARS - header.length - footer.length;
  const sections: string[] = [];
  for (const item of input.context) {
    const section = `\n=== TEAM CONTEXT: ${item.type} (${item.id}) ===\n${item.content}\n`;
    if (section.length > budget) continue;
    sections.push(section);
    budget -= section.length;
  }
  return header + sections.join("") + footer;
}

/** Poll delays: quick first checks, then backoff — ~75s total budget by default. */
export const BRIDGE_POLL_DELAYS_MS = [500, 750, 1_000, 1_500, 2_000, 2_500, 3_000];
export const BRIDGE_POLL_TOTAL_BUDGET_MS = 75_000;

/**
 * Job-class budgets. Interactive features keep the 0486 numbers. Heavy features
 * (season reports, dreams, CAD plans — anything outside BRIDGE_CHAT_FEATURES that a
 * device with coverage='everything' serves) get a long CLI budget and a web poll
 * budget that outlasts it plus claim/report latency, sized to leave real headroom
 * under the 300s maxDuration the heavy AI routes declare. The claim function grows
 * the job lease from the enqueued timeoutMs so a long CLI run is never declared
 * lease_expired mid-flight.
 *
 * Deployments whose functions are capped lower (Vercel Hobby's 60s) set
 * VANTAGE_BRIDGE_MAX_WAIT_MS. Read it through bridgeHeavyPollBudgetMs() at call
 * time — never at module scope, so importing this module stays config-free.
 */
export const BRIDGE_INTERACTIVE_CLI_TIMEOUT_MS = 90_000;
export const BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS = 240_000;
/** Poll budget minus CLI budget: claim + report latency plus a poll interval of slack. */
export const BRIDGE_HEAVY_POLL_HEADROOM_MS = 30_000;
export const BRIDGE_HEAVY_CLI_TIMEOUT_MS =
  BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS - BRIDGE_HEAVY_POLL_HEADROOM_MS;

export const BRIDGE_MAX_WAIT_ENV = "VANTAGE_BRIDGE_MAX_WAIT_MS";
/** Under 15s nothing heavy can finish; over 330s the device clamps the CLI budget anyway. */
export const BRIDGE_MAX_WAIT_MIN_MS = 15_000;
export const BRIDGE_MAX_WAIT_MAX_MS = 330_000;

/**
 * Operator-tunable poll budget for heavy bridged turns. Out-of-range values clamp;
 * unset/blank/non-numeric fall back to the default so a typo can never disable the
 * bridge. Pure and lazily resolved — pass `env` in tests.
 */
export function bridgeHeavyPollBudgetMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[BRIDGE_MAX_WAIT_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return BRIDGE_HEAVY_POLL_TOTAL_BUDGET_MS;
  return Math.min(BRIDGE_MAX_WAIT_MAX_MS, Math.max(BRIDGE_MAX_WAIT_MIN_MS, Math.round(parsed)));
}

/**
 * Derived, never configured separately: the CLI has to finish AND report inside the
 * poll budget, so it always gets the budget minus headroom — the relationship cannot
 * drift out of a config change.
 */
export function bridgeHeavyCliTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const budget = bridgeHeavyPollBudgetMs(env);
  return budget - Math.min(BRIDGE_HEAVY_POLL_HEADROOM_MS, Math.round(budget / 4));
}

export function nextBridgePollDelay(attempt: number): number {
  return BRIDGE_POLL_DELAYS_MS[Math.min(attempt, BRIDGE_POLL_DELAYS_MS.length - 1)]!;
}

/** Map a failed job's error_class onto the degraded taxonomy the resolver surfaces. */
export function degradedReasonForErrorClass(errorClass: string | null | undefined): BridgeDegradedReason {
  if (errorClass === "rate_limited") return "bridge-rate-limited";
  if (errorClass === "cli_timeout") return "bridge-timeout";
  // queue_expired / lease_expired / not_authenticated / cli_error: the bridge could not
  // serve the turn — from the caller's seat that is the bridge being unavailable.
  return errorClass === "queue_expired" || errorClass === "lease_expired"
    ? "bridge-offline"
    : "bridge-timeout";
}

export type SubscriptionBridgeAdapterConfig = {
  transport: SubscriptionBridgeTransport;
  orgId: string;
  userId?: string | null;
  feature: string;
  requestedEngine?: "claude" | "codex" | null;
  /** Resolved normal key chain to fall through to; null = no fallback, throw honestly. */
  fallback?: ChatAdapter | null;
  /**
   * Lazy alternative to `fallback`, used by the resolver: run only when a turn actually
   * falls through, then memoized. Keeps the whole key chain (routing prefs, org+member
   * key loads, a KMS decrypt round trip) off the happy path, where the bridge answers.
   * A factory that throws or resolves null means the same thing as `fallback: null`.
   */
  fallbackFactory?: () => ChatAdapter | null | Promise<ChatAdapter | null>;
  /** CLI budget enqueued with the job. Default: interactive (90s). */
  cliTimeoutMs?: number;
  systemPrompt?: string;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  totalBudgetMs?: number;
};

/**
 * Anything the transport throws that is not already a bridge failure (missing
 * DATABASE_AI_BRIDGE_URL so the pool cannot be built, pool exhaustion, a DB blip) is
 * still the bridge failing to serve this turn — convert it so the fallback chain
 * engages instead of hard-failing a request that has a perfectly good org key. The
 * original text rides along in the message so operators see the real cause.
 */
function asBridgeFailure(error: unknown): SubscriptionBridgeError {
  if (error instanceof SubscriptionBridgeError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new SubscriptionBridgeError(
    `The subscription bridge could not be reached: ${detail}`,
    "bridge-offline",
    "transport_error",
  );
}

export class SubscriptionBridgeChatAdapter implements ChatAdapter {
  /** Set from the CLI's reported model after a completed turn; readable via `model`. */
  private lastModel: string;
  /** Set to the fallback's provider on a turn that fell through; readable via `provider`. */
  private fallbackProvider: string | null = null;
  /** Memoized lazy fallback: resolved at most once, and only when a turn needs it. */
  private fallbackResolution: Promise<ChatAdapter | null> | null = null;
  /** Why the last turn fell through to the fallback chain; null when the bridge served it. */
  lastDegraded: BridgeDegradedReason | null = null;

  constructor(private readonly config: SubscriptionBridgeAdapterConfig) {
    this.lastModel = config.requestedEngine === "codex" ? "codex-cli" : "claude-code";
  }

  /**
   * The bridge id until a turn falls through, then whoever actually answered — callers
   * read this inside their invoke callback and write it to ai_usage_events.provider, so
   * real Anthropic/OpenAI spend must not be booked as a $0 bridge turn.
   * BEFORE any turn runs it always reads "subscription-bridge": meteredAI in
   * packages/billing/src/index.ts classifies key_source='subscription_bridge' from that
   * pre-call value, and that contract has to hold.
   */
  get provider(): string {
    return this.fallbackProvider ?? "subscription-bridge";
  }

  get model(): string {
    return this.lastModel;
  }

  async complete(input: { message: string; context: ContextItem[]; promptCachingEnabled?: boolean }) {
    this.lastDegraded = null;
    this.fallbackProvider = null;
    try {
      return await this.completeViaBridge(input);
    } catch (error) {
      const failure = asBridgeFailure(error);
      this.lastDegraded = failure.degraded;
      const fallback = await this.resolveFallback();
      if (!fallback) throw failure;
      const result = await fallback.complete(input);
      this.lastModel = fallback.model;
      this.fallbackProvider = fallback.provider;
      return result;
    }
  }

  /** An eagerly supplied `fallback` wins; otherwise the factory runs at most once. */
  private resolveFallback(): Promise<ChatAdapter | null> {
    if (this.config.fallback) return Promise.resolve(this.config.fallback);
    const factory = this.config.fallbackFactory;
    if (!factory) return Promise.resolve(null);
    this.fallbackResolution ??= (async () => {
      try {
        return (await factory()) ?? null;
      } catch {
        // A chain that cannot resolve is exactly "no fallback": throw the bridge error.
        return null;
      }
    })();
    return this.fallbackResolution;
  }

  private async completeViaBridge(input: { message: string; context: ContextItem[] }) {
    const sleep = this.config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = this.config.now ?? Date.now;
    const budget = this.config.totalBudgetMs ?? BRIDGE_POLL_TOTAL_BUDGET_MS;
    const prompt = buildBridgePromptDocument({
      message: input.message,
      context: input.context,
      systemPrompt: this.config.systemPrompt,
    });
    const { jobId } = await this.config.transport.enqueue({
      orgId: this.config.orgId,
      userId: this.config.userId ?? null,
      feature: this.config.feature,
      prompt,
      requestedEngine: this.config.requestedEngine ?? null,
      timeoutMs: this.config.cliTimeoutMs ?? BRIDGE_INTERACTIVE_CLI_TIMEOUT_MS,
    });
    const startedAt = now();
    for (let attempt = 0; ; attempt += 1) {
      await sleep(nextBridgePollDelay(attempt));
      const status = await this.config.transport.poll(jobId);
      if (status.state === "done" && status.result?.text) {
        if (status.result.model) this.lastModel = status.result.model;
        const usage = status.result.usage ?? {};
        return {
          text: status.result.text,
          promptTokens: usage.inputTokens ?? 0,
          completionTokens: usage.outputTokens ?? 0,
          cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
          // The subscriber's plan already paid for this turn — Vantage charges $0.
          costUsd: 0,
        };
      }
      if (status.state === "done") {
        throw new SubscriptionBridgeError("Bridge returned an empty result.", "bridge-timeout", "cli_error");
      }
      if (status.state === "failed" || status.state === "expired") {
        const reason = degradedReasonForErrorClass(status.errorClass);
        throw new SubscriptionBridgeError(
          status.errorClass === "rate_limited"
            ? // Verbatim provider text — includes the reset time when the CLI reported one.
              `The bridge subscription hit its rate limit: ${status.errorMessage ?? "limit reached"}`
            : status.errorMessage ?? `Bridge job ${status.state}.`,
          reason,
          status.errorClass ?? null,
        );
      }
      if (now() - startedAt >= budget) {
        await this.config.transport.abandon(jobId).catch(() => undefined);
        throw new SubscriptionBridgeError(
          "The subscription bridge did not answer in time.",
          "bridge-timeout",
          "cli_timeout",
        );
      }
    }
  }
}
