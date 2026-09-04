import type { ChatAdapter, ChatCompletionResult, ContextItem } from "./index";
import { ProviderRateLimitError } from "./http-chat-adapter";
import { isChatUpstreamTimeout } from "./chat-timeout";
import {
  freeRelayPoolLabel,
  readFreeRelayConfigs,
  tryCreateFreeRelayAdapter,
  tryCreateGroqFreeAdapter,
  tryCreateOpenRouterFreeAdapter,
} from "./hosted-platform-keys";

/**
 * Failover wrapper for the platform free relay (FreeBuff/Codebuff proxy on a Pi).
 *
 * The relay is not a cloud provider: it is a single self-hosted box on a home
 * connection. Even on an unmetered upstream model it goes away when the box sleeps, the
 * tunnel drops, or the provider pauses at peak hours — and on a metered model it also
 * runs out of daily sessions. Being unavailable is its normal steady state, not an
 * exception, so a team holding a `platform_relay` grant must degrade to the next free
 * pool instead of seeing a failed request.
 *
 * Ordering is caller-supplied. `provider` / `model` track whoever actually served the
 * call so metering and the usage ledger record the real upstream rather than the
 * primary we hoped for.
 */

export type RelayFailoverEntry = {
  /** Short label for error text — never a key or a full URL with credentials. */
  label: string;
  adapter: ChatAdapter;
  /** Pi tunnels rotate for throughput; OpenRouter/Groq stay last-resort. */
  kind?: "relay" | "fallback";
};

/** Node/undici surfaces a refused or unroutable socket as `TypeError: fetch failed`. */
const UNREACHABLE_CAUSE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function causeCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** The host is not answering at all: box asleep, tunnel down, DNS or TLS broken. */
export function isRelayUnreachableError(error: unknown): boolean {
  if (isChatUpstreamTimeout(error)) return true;
  const code = causeCode(error);
  if (code && UNREACHABLE_CAUSE_CODES.has(code)) return true;
  if (!(error instanceof Error)) return false;
  return /fetch failed|network|socket hang up|econnrefused|und_err|self.signed certificate|unable to verify/i.test(
    error.message,
  );
}

/**
 * Worth trying the next entry rather than failing the request.
 *
 * Includes the relay's own 401/403: the credential is the operator's FreeBuff token,
 * so a team cannot act on it and should be served from the next pool instead of being
 * told to fix a key it does not own. FreeBuff's `free_mode_cli_required` lands here
 * too — it means the proxy stopped looking like the official CLI, which is again
 * operator-side.
 */
export function isRelayFailoverWorthy(error: unknown): boolean {
  if (isRelayUnreachableError(error)) return true;
  if (error instanceof ProviderRateLimitError) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  if (/\b(401|402|403|429|500|502|503|504|529)\b/.test(msg)) return true;
  return /rate.?limit|quota|capacity|overloaded|unavailable|exhausted|too many requests|free_mode_cli_required|was rejected|timed out/i.test(
    msg,
  );
}

/**
 * Build the platform-relay chain for a team holding a `platform_relay` grant:
 * FreeBuff on the Pi first, then whichever platform-wide free pools are configured.
 *
 * Returns null when no relay is configured at all, so callers can skip the grant
 * lookup entirely on deployments that have no Pi — the fallback pools on their own
 * are the generic free-tier path, not a relay grant.
 */
let relayRotateCursor = 0;

export function resetRelayRotateCursor(): void {
  relayRotateCursor = 0;
}

export function tryCreatePlatformRelayAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
  model?: string | null;
  orgId?: string | null;
  teamNumber?: number | null;
}): RelayFailoverChatAdapter | null {
  const env = input?.env ?? process.env;
  const configs = readFreeRelayConfigs(env);
  if (configs.length === 0) return null;

  const entries: RelayFailoverEntry[] = [];
  for (const config of configs) {
    const adapter = tryCreateFreeRelayAdapter({
      ...input,
      env,
      model: input?.model,
      config,
      teamNumber: input?.teamNumber,
    });
    if (!adapter) continue;
    entries.push({
      label: freeRelayPoolLabel(config),
      kind: "relay",
      adapter,
    });
  }
  if (entries.length === 0) return null;

  const openrouter = tryCreateOpenRouterFreeAdapter({ ...input, env });
  if (openrouter) entries.push({ label: "openrouter-free", kind: "fallback", adapter: openrouter });

  const groq = tryCreateGroqFreeAdapter({ ...input, env });
  if (groq) entries.push({ label: "groq-free", kind: "fallback", adapter: groq });

  return new RelayFailoverChatAdapter(entries, { rotateRelays: true });
}

export class RelayFailoverChatAdapter implements ChatAdapter {
  /** Mutates after a served call so metering sees the live upstream. */
  provider: string;
  model: string;
  readonly supportsNativeTools: boolean;

  private readonly entries: RelayFailoverEntry[];
  private readonly rotateRelays: boolean;
  private live: RelayFailoverEntry;

  constructor(
    entries: RelayFailoverEntry[],
    options?: { rotateRelays?: boolean },
  ) {
    if (entries.length === 0) {
      throw new Error("RelayFailoverChatAdapter requires at least one entry.");
    }
    this.entries = entries;
    this.rotateRelays = options?.rotateRelays === true;
    this.live = entries[0]!;
    this.provider = entries[0]!.adapter.provider;
    this.model = entries[0]!.adapter.model;
    // Conservative: a caller branching on native tool support must not be surprised
    // when a later entry serves the call.
    this.supportsNativeTools = entries.every((e) => e.adapter.supportsNativeTools === true);
  }

  private orderedEntries(): RelayFailoverEntry[] {
    if (!this.rotateRelays) return this.entries;
    const relays = this.entries.filter((entry) => entry.kind !== "fallback");
    const fallbacks = this.entries.filter((entry) => entry.kind === "fallback");
    if (relays.length <= 1) return this.entries;
    const start = relayRotateCursor % relays.length;
    relayRotateCursor += 1;
    return [...relays.slice(start), ...relays.slice(0, start), ...fallbacks];
  }

  get configuredLabels(): string[] {
    return this.entries.map((e) => e.label);
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.live.adapter.estimateCostUsd?.(promptTokens, completionTokens) ?? 0;
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: Parameters<ChatAdapter["complete"]>[0]["history"];
    tools?: Parameters<ChatAdapter["complete"]>[0]["tools"];
    promptCachingEnabled?: boolean;
  }): Promise<ChatCompletionResult> {
    const failures: string[] = [];
    const order = this.orderedEntries();

    for (let i = 0; i < order.length; i += 1) {
      const entry = order[i]!;
      try {
        // Identical input every attempt — never strip context, history, or tools.
        const result = await entry.adapter.complete(input);
        this.live = entry;
        this.provider = entry.adapter.provider;
        this.model = entry.adapter.model;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${entry.label}: ${message}`);
        const last = i === order.length - 1;
        if (last || !isRelayFailoverWorthy(error)) {
          throw new Error(
            `Platform free relay could not serve this request. Tried ${failures.length} upstream(s) — ${failures.join(" | ")}`,
            { cause: error },
          );
        }
      }
    }

    // Unreachable: the loop either returns or throws on its final entry.
    throw new Error(`Platform free relay exhausted every upstream — ${failures.join(" | ")}`);
  }
}
