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
  loadCreditGiftKeys,
  resolvePoolKeySecret,
  sendCreditGiftAlertEmail,
  type ActiveCreditGift,
  type CreditGiftLedger,
  type CreditGiftModel,
  type PoolKeyEnvelope,
} from "@vantage/billing";
import type { ChatAdapter, ChatMessage, ChatToolDefinition, ContextItem } from "./index";
import { chatCompletionMaxTokens, HttpChatAdapter, pricesForPrompt, ProviderRateLimitError } from "./http-chat-adapter";
import { KeyFailoverChatAdapter, type FailoverKey } from "./key-failover-adapter";

/**
 * Ask AI paid from AI credit a platform admin gifted the team (migration 0727).
 *
 * Every call reserves its worst-case cost against the gift's ledger before the provider sees
 * it, in a short transaction of its own, and settles at the real cost afterwards, whichever of
 * the operator's pool keys answered (the keys fail over in the operator's order inside one
 * reservation; a key the provider turns away was not billed). The wrapped adapters are the only
 * holders of the operator's keys, and this class is the only way to them, so the cap holds on
 * every path that reaches a key: the chat, the feature helpers that resolve an adapter, and a
 * subscription bridge falling back mid-turn.
 */

const GOOGLE_OPENAI_COMPAT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";


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
      inner: KeyFailoverChatAdapter;
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
      // Bytes bound the prompt's tokens, so a long prompt is held at the long-prompt rate.
      prices: pricesForPrompt(giftModel.modelId, giftModel.prices, bounds.inputBytes),
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
      // Every key failing over to the next ends here with the last provider refusal: nothing
      // was billed. Anything else may have been.
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
        keyId: inner.servedKey?.id ?? null,
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
 * for (no pool key with a usable secret). `usableOnly` skips a used-up gift (so a team with
 * other free AI keeps it); without it a used-up gift is still returned, so the refusal can say
 * the free credit is used up.
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
    decryptVault: (envelope: PoolKeyEnvelope) => Promise<string>;
    ledger?: CreditGiftLedger;
    usableOnly: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CreditGiftRouting | null> {
  if (!input.userId) return null;
  const gift = await loadActiveCreditGift(client, input.orgId);
  if (!gift) return null;
  if (input.usableOnly && !creditGiftUsable(gift)) return null;

  const family = CREDIT_GIFT_FAMILIES[gift.family];
  const giftModel = creditGiftModelFor(gift.family, input.difficulty);
  const capability = input.feature ?? "chat";
  const keys: FailoverKey[] = [];
  for (const key of await loadCreditGiftKeys(client, gift.giftId)) {
    const apiKey = await resolvePoolKeySecret(gift.family, key, input.decryptVault, input.env);
    if (!apiKey) continue;
    keys.push({
      id: key.keyId,
      label: key.label,
      scope: "platform",
      adapter: new HttpChatAdapter({
        provider: family.provider === "anthropic" ? "anthropic" : family.provider === "openai" ? "openai" : "openai-compatible",
        model: giftModel.modelId,
        apiKey,
        baseUrl: family.provider === "google" ? GOOGLE_OPENAI_COMPAT_BASE : undefined,
        promptCachingEnabled: input.promptCachingEnabled,
        prices: giftModel.prices,
        fetchImpl: input.fetchImpl,
        providerLabel: family.provider,
        capability,
        effort: giftModel.effort,
        // OpenAI-shaped calls get the same output room Anthropic chat calls carry.
        maxOutputTokens: chatCompletionMaxTokens(capability, giftModel.modelId),
      }),
    });
  }
  if (!keys.length) return null;

  const ledger = input.ledger ?? createCreditGiftLedger({ userId: input.userId, orgId: input.orgId });
  const inner = new KeyFailoverChatAdapter(keys as [FailoverKey, ...FailoverKey[]], async (result) => {
    if (!result.ok) await ledger.noteKeyFailure({ giftId: gift.giftId, keyId: result.key.id, reason: result.reason ?? "Request failed" });
  });
  const adapter = new CreditGiftChatAdapter({
    inner,
    giftModel,
    giftId: gift.giftId,
    orgId: input.orgId,
    userId: input.userId,
    feature: capability,
    ledger,
  });
  return { gift, adapter };
}
