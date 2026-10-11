import { noteServedKey, type ServedKey } from "@vantage/billing";
import type { ChatAdapter, ChatMessage, ChatToolDefinition, ContextItem } from "./index";
import { ProviderRateLimitError, type HttpChatAdapter } from "./http-chat-adapter";

/**
 * Several keys for one provider, tried in the order their owner set. A key the provider turns
 * away (429 / 402 / 503 capacity, a 5xx, or a rejected key) hands the turn to the next one; any
 * other failure (a bad request, a timeout that may already have been billed) is thrown as it is,
 * because the next key would fail the same way or cost twice.
 *
 * The key that answered is recorded by id and label (never the secret) for the usage ledger,
 * and each attempt's outcome goes to `onResult` so a failing key can be marked degraded.
 */

export type FailoverKey = ServedKey & { adapter: HttpChatAdapter };

export type KeyAttemptResult = { key: ServedKey; ok: boolean; reason: string | null };

/** Why a key failed, in words safe to store and show: never the key, a URL or a header. */
export function keyFailureReason(error: unknown): string {
  if (error instanceof ProviderRateLimitError) {
    return error.status === 402
      ? "Out of credit or quota at the provider (402)"
      : error.status === 503
        ? "Provider at capacity (503)"
        : "Rate limited by the provider (429)";
  }
  const message = error instanceof Error ? error.message : "";
  const status = /\((\d{3})/.exec(message)?.[1];
  if (/API key was rejected/.test(message)) return `Key rejected by the provider (${status ?? "401"})`;
  if (status && Number(status) >= 500) return `Provider error (${status})`;
  return "Request failed";
}

/** Whether the next key should get the turn: capacity, provider errors and rejected keys only. */
export function shouldFailOver(error: unknown): boolean {
  if (error instanceof ProviderRateLimitError) return true;
  const message = error instanceof Error ? error.message : "";
  if (/API key was rejected \((401|403)/.test(message)) return true;
  const status = /chat failed \((\d{3})/.exec(message)?.[1];
  return Boolean(status && Number(status) >= 500);
}

export class KeyFailoverChatAdapter implements ChatAdapter {
  readonly provider: string;
  readonly model: string;
  readonly supportsNativeTools = true;
  readonly baseUrl: string;
  /** The key that answered the last turn, for the ledger. */
  servedKey: ServedKey | null = null;

  constructor(
    private readonly keys: [FailoverKey, ...FailoverKey[]],
    private readonly onResult?: (result: KeyAttemptResult) => Promise<void> | void,
  ) {
    const first = keys[0].adapter;
    this.provider = first.provider;
    this.model = first.model;
    this.baseUrl = first.baseUrl;
  }

  get keyCount(): number {
    return this.keys.length;
  }

  /** Every key's adapter is built the same way, so the first one's bounds hold for all. */
  requestBounds(input: Parameters<HttpChatAdapter["requestBounds"]>[0]) {
    return this.keys[0].adapter.requestBounds(input);
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.keys[0].adapter.estimateCostUsd(promptTokens, completionTokens);
  }

  private async report(result: KeyAttemptResult) {
    try {
      await this.onResult?.(result);
    } catch {
      // Key health is bookkeeping; it never fails a turn.
    }
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: ChatMessage[];
    tools?: ChatToolDefinition[];
    promptCachingEnabled?: boolean;
  }) {
    let lastError: unknown;
    for (const entry of this.keys) {
      const key: ServedKey = { id: entry.id, label: entry.label, scope: entry.scope };
      try {
        const result = await entry.adapter.complete(input);
        this.servedKey = key;
        noteServedKey(key);
        await this.report({ key, ok: true, reason: null });
        return result;
      } catch (error) {
        lastError = error;
        if (!shouldFailOver(error)) throw error;
        await this.report({ key, ok: false, reason: keyFailureReason(error) });
      }
    }
    throw lastError;
  }
}
