import type { ChatAdapter } from "./index";
import { ProviderRateLimitError, type HttpChatAdapter } from "./http-chat-adapter";

/**
 * One key, several models: try the chosen model, and when the provider says it cannot
 * serve the key right now (429 no quota, 402, 503 overloaded), answer on the next one.
 *
 * Exists for free Google AI Studio keys. Gemini Pro has no free tier, so Automode sending
 * CAD or coding work to Pro turned "a free Gemini key works" into a 429 on exactly the
 * features that pick the strongest model; and the newest Flash answers 503 "high demand"
 * often enough to fail a chat turn. Anything other than a quota or capacity answer is
 * thrown unchanged: a rejected key or a bad request fails the same way on the next model.
 */
export class ModelFallbackChatAdapter implements ChatAdapter {
  readonly provider: string;
  /** Updates after a fallback answers so metering and provenance name the model that did. */
  model: string;
  readonly supportsNativeTools = true;
  readonly baseUrl: string;
  private answeredBy: HttpChatAdapter;

  /** `adapters` in the order to try them; the first is the chosen model. */
  constructor(private readonly adapters: [HttpChatAdapter, ...HttpChatAdapter[]]) {
    this.answeredBy = adapters[0];
    this.provider = this.answeredBy.provider;
    this.model = this.answeredBy.model;
    this.baseUrl = this.answeredBy.baseUrl;
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.answeredBy.estimateCostUsd(promptTokens, completionTokens);
  }

  async complete(input: Parameters<ChatAdapter["complete"]>[0]) {
    let lastError: unknown;
    for (const adapter of this.adapters) {
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
    throw lastError;
  }
}
