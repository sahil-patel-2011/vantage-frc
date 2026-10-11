import type { PoolClient } from "@neondatabase/serverless";
import {
  CREDIT_GIFT_FAMILIES,
  CREDIT_GIFT_PROVIDER,
  UsageHardCutoffError,
  createCreditGiftLedger,
  creditGiftModelFor,
  creditGiftUsable,
  giftCallCeilingUsd,
  loadActiveCreditGift,
  resolveCreditGiftKey,
  sendCreditGiftAlertEmail,
  type ActiveCreditGift,
  type CreditGiftLedger,
  type CreditGiftModel,
} from "@vantage/billing";
import type { ChatAdapter, ChatMessage, ChatToolDefinition, ContextItem } from "./index";
import { HttpChatAdapter, ProviderRateLimitError } from "./http-chat-adapter";

/**
 * Ask AI paid from AI credit a platform admin gifted the team (migration 0727).
 *
 * Every call reserves its worst-case cost against the gift's ledger before the provider sees
 * it, in a short transaction of its own, and settles at the real cost afterwards. The wrapped
 * adapter is the only holder of the operator's key, and this class is the only way to it, so
 * the cap holds on every path that reaches the key: the chat, the ~50 feature helpers that
 * resolve an adapter, and a subscription bridge falling back mid-turn.
 */

const GOOGLE_OPENAI_COMPAT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** OpenAI-shaped calls get the same output cap Anthropic chat calls carry. */
function giftOutputCap(capability: string): number {
  return /^(agent|cad|coding|maintenance|bugbot)/i.test(capability.trim()) ? 4096 : 1024;
}

/**
 * A call the provider answered with an error status was not billed, so its hold is released.
 * Anything else (a timeout, a dropped connection) may have been billed: the hold settles at the
 * reserved worst case, which never undercounts.
 */
export function providerDidNotBill(error: unknown): boolean {
  if (error instanceof ProviderRateLimitError) return true;
  const message = error instanceof Error ? error.message : "";
  return /API key was rejected \(\d{3}|chat failed \(\d{3}/.test(message);
}

export class CreditGiftChatAdapter implements ChatAdapter {
  readonly provider = CREDIT_GIFT_PROVIDER;
  readonly model: string;
  readonly supportsNativeTools = true;
  readonly baseUrl: string;

  constructor(
    private readonly options: {
      inner: HttpChatAdapter;
      giftModel: CreditGiftModel;
      giftId: string;
      orgId: string;
      userId: string;
      feature: string;
      ledger: CreditGiftLedger;
    },
  ) {
    this.model = options.inner.model;
    this.baseUrl = options.inner.baseUrl;
  }

  /** The provider that really answers ("anthropic", "openai", …), for provenance. */
  get upstreamProvider(): string {
    return this.options.inner.provider;
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return this.options.inner.estimateCostUsd(promptTokens, completionTokens);
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: ChatMessage[];
    tools?: ChatToolDefinition[];
    promptCachingEnabled?: boolean;
  }) {
    const { inner, ledger, giftId, giftModel } = this.options;
    const bounds = inner.requestBounds(input);
    // An adapter without an output cap has no ceiling, and a gift is never spent without one.
    if (!bounds.maxOutputTokens) throw new UsageHardCutoffError("gift_credit_ended");
    const ceilingUsd = giftCallCeilingUsd({
      inputBytes: bounds.inputBytes,
      maxOutputTokens: bounds.maxOutputTokens,
      prices: giftModel.prices,
    });
    const hold = await ledger.reserve({
      giftId,
      amountUsd: ceilingUsd,
      model: giftModel.modelId,
      feature: this.options.feature,
    });
    if (hold.outcome === "inactive") throw new UsageHardCutoffError("gift_credit_ended");
    if (hold.outcome !== "held" || !hold.holdId) throw new UsageHardCutoffError("gift_credit_exhausted");

    let result: Awaited<ReturnType<HttpChatAdapter["complete"]>>;
    try {
      result = await inner.complete(input);
    } catch (error) {
      const released = providerDidNotBill(error);
      await ledger
        .settle({ holdId: hold.holdId, costUsd: released ? 0 : ceilingUsd, promptTokens: 0, completionTokens: 0, released })
        .catch(() => null);
      throw error;
    }

    try {
      const alert = await ledger.settle({
        holdId: hold.holdId,
        costUsd: result.costUsd,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        released: false,
      });
      if (alert) {
        await sendCreditGiftAlertEmail({ orgId: this.options.orgId, userId: this.options.userId, giftId, alert });
      }
    } catch {
      // The answer already exists and is returned. The hold stays at its reserved worst case,
      // which counts at least what the call cost, so the cap still holds.
    }
    return result;
  }
}

export type CreditGiftRouting = {
  gift: ActiveCreditGift;
  adapter: CreditGiftChatAdapter;
};

/**
 * The gift-funded adapter for this team, or null when it has no gift this deployment can pay
 * for. `usableOnly` skips a used-up gift (so a team with other free AI keeps it); without it a
 * used-up gift is still returned, so the refusal can say the free credit is used up.
 */
export async function resolveCreditGiftAdapter(
  client: PoolClient,
  input: {
    orgId: string;
    userId?: string;
    feature?: string;
    difficulty?: string;
    promptCachingEnabled: boolean;
    fetchImpl?: typeof fetch;
    decryptVault: (vault: NonNullable<ActiveCreditGift["vault"]>) => Promise<string>;
    ledger?: CreditGiftLedger;
    usableOnly: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CreditGiftRouting | null> {
  if (!input.userId) return null;
  const gift = await loadActiveCreditGift(client, input.orgId);
  if (!gift) return null;
  if (input.usableOnly && !creditGiftUsable(gift)) return null;
  const apiKey = await resolveCreditGiftKey(gift, input.decryptVault, input.env);
  if (!apiKey) return null;

  const family = CREDIT_GIFT_FAMILIES[gift.family];
  const giftModel = creditGiftModelFor(gift.family, input.difficulty);
  const capability = input.feature ?? "chat";
  const inner = new HttpChatAdapter({
    provider: family.provider === "anthropic" ? "anthropic" : family.provider === "openai" ? "openai" : "openai-compatible",
    model: giftModel.modelId,
    apiKey,
    baseUrl: family.provider === "google" ? GOOGLE_OPENAI_COMPAT_BASE : undefined,
    promptCachingEnabled: input.promptCachingEnabled,
    prices: giftModel.prices,
    fetchImpl: input.fetchImpl,
    providerLabel: family.provider,
    capability,
    maxOutputTokens: giftOutputCap(capability),
  });
  const adapter = new CreditGiftChatAdapter({
    inner,
    giftModel,
    giftId: gift.giftId,
    orgId: input.orgId,
    userId: input.userId,
    feature: capability,
    ledger: input.ledger ?? createCreditGiftLedger({ userId: input.userId, orgId: input.orgId }),
  });
  return { gift, adapter };
}
