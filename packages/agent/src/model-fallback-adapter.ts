import type { ChatAdapter } from "./index";
import { ProviderRateLimitError, type HttpChatAdapter } from "./http-chat-adapter";
import { assertRemoteImageAdapter } from "./chat-image";

/**
 * Several ways to answer one turn — other models on the same key, then the same models on
 * another key. Try them in order, and when the provider says it cannot serve this one
 * right now (429 no quota, 402, 503 overloaded), answer on the next.
 *
 * Exists for free Google AI Studio keys: quota is counted per model and per key, the newest
 * Flash answers 503 "high demand" often enough to fail a chat turn, and Pro has no free
 * quota at all. Anything other than a quota or capacity answer is thrown unchanged: a
 * rejected key or a bad request fails the same way on the next model.
 */
export class ModelFallbackChatAdapter implements ChatAdapter {
  readonly provider: string;
  /** Updates after a fallback answers so metering and provenance name the model that did. */
  model: string;
  readonly supportsNativeTools = true;
  get supportsImages(): boolean { return this.adapters.every((adapter) => adapter.supportsImages); }
  readonly baseUrl: string;
  private answeredBy: HttpChatAdapter;

  /**
   * `adapters` in the order to try them; the first is the chosen model. `exhaustedMessage`
   * is what the person reads when none of them could answer.
   */
  constructor(
    private readonly adapters: [HttpChatAdapter, ...HttpChatAdapter[]],
    private readonly exhaustedMessage?: string,
  ) {
    this.answeredBy = adapters[0];
    this.provider = this.answeredBy.provider;
    this.model = this.answeredBy.model;
    this.baseUrl = this.answeredBy.baseUrl;
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.answeredBy.estimateCostUsd(promptTokens, completionTokens);
  }

  async complete(input: Parameters<ChatAdapter["complete"]>[0]) {
    input.signal?.throwIfAborted();
    if (input.image !== undefined || input.images !== undefined) assertRemoteImageAdapter(this);
    let lastError: ProviderRateLimitError | undefined;
    for (const adapter of this.adapters) {
      input.signal?.throwIfAborted();
      try {
        const result = await adapter.complete(input);
        this.answeredBy = adapter;
        this.model = adapter.model;
        return result;
      } catch (error) {
        if (!(error instanceof ProviderRateLimitError)) throw error;
        lastError = error;
      }
    }
    if (this.exhaustedMessage && lastError) {
      throw new ProviderRateLimitError(this.exhaustedMessage, lastError.status);
    }
    throw lastError;
  }
}
