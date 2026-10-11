import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREDIT_GIFT_PROVIDER,
  UsageHardCutoffError,
  evaluateGiftReservation,
  setCreditGiftAlertMailer,
  type CreditGiftLedger,
  type GiftReserveResult,
} from "@vantage/billing";
import { CreditGiftChatAdapter, providerDidNotBill, resolveCreditGiftAdapter } from "../src/credit-gift-adapter";
import { HttpChatAdapter, ProviderRateLimitError } from "../src/http-chat-adapter";
import { ChatUpstreamTimeoutError } from "../src/chat-timeout";
import { resolveOrgChatAdapterWithProvenance } from "../src/resolve-chat-adapter";

/**
 * An in-memory ledger with the database's semantics: reservations are serialized (the gift row
 * lock), spent = settled costs + open holds, and a reservation that would cross the gift is
 * refused. The SQL itself is exercised against Postgres in qa/admin/rls-0727.sql.
 */
function memoryLedger(amountUsd: number) {
  let spentSettled = 0;
  const holds = new Map<string, { reserved: number; state: "held" | "settled" | "released" }>();
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const serialized = <T,>(work: () => T | Promise<T>) => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
  const spent = () =>
    spentSettled + [...holds.values()].filter((h) => h.state === "held").reduce((sum, h) => sum + h.reserved, 0);
  const refused: number[] = [];
  const ledger: CreditGiftLedger = {
    reserve: (input) =>
      serialized(async (): Promise<GiftReserveResult> => {
        // Yield, as a real round trip would, so concurrent callers interleave.
        await new Promise((resolve) => setTimeout(resolve, 1));
        const decision = evaluateGiftReservation({ amountUsd, spentUsd: spent(), requestUsd: input.amountUsd });
        if (!decision.allowed) {
          refused.push(input.amountUsd);
          return { holdId: null, outcome: "refused", amountUsd, spentUsd: spent() };
        }
        const id = `h${++seq}`;
        holds.set(id, { reserved: decision.spentAfterUsd - spent(), state: "held" });
        return { holdId: id, outcome: "held", amountUsd, spentUsd: decision.spentAfterUsd };
      }),
    settle: (input) =>
      serialized(async () => {
        const hold = holds.get(input.holdId);
        if (!hold || hold.state !== "held") return null;
        hold.state = input.released ? "released" : "settled";
        if (!input.released) spentSettled += input.costUsd;
        return amountUsd - spentSettled < 0.05 ? ("exhausted" as const) : null;
      }),
  };
  return { ledger, spent, refused, settled: () => spentSettled };
}

function anthropicResponse(inputTokens: number, outputTokens: number) {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function giftAdapter(ledger: CreditGiftLedger, fetchImpl: typeof fetch) {
  const prices = { inputPerMillionUsd: 2, outputPerMillionUsd: 10, cacheReadPerMillionUsd: 0.2, cacheWritePerMillionUsd: 2.5 };
  const inner = new HttpChatAdapter({
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    apiKey: "sk-ant-test",
    promptCachingEnabled: false,
    prices,
    fetchImpl,
    capability: "chat",
  });
  return new CreditGiftChatAdapter({
    inner,
    giftModel: { modelId: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", role: "everyday", prices },
    giftId: "gift-1",
    orgId: "org-1",
    userId: "user-1",
    feature: "chat",
    ledger,
  });
}

const ask = { message: "Which teams should we pick?", context: [] };

afterEach(() => setCreditGiftAlertMailer(null));

describe("CreditGiftChatAdapter", () => {
  it("reports the gift provider so meteredAI meters it as a gift", () => {
    const { ledger } = memoryLedger(10);
    const adapter = giftAdapter(ledger, vi.fn() as never);
    expect(adapter.provider).toBe(CREDIT_GIFT_PROVIDER);
    expect(adapter.upstreamProvider).toBe("anthropic");
    expect(adapter.model).toBe("claude-sonnet-5-5");
  });

  it("reserves before the provider call and settles the real cost after it", async () => {
    const memory = memoryLedger(10);
    const order: string[] = [];
    const reserve = memory.ledger.reserve;
    memory.ledger.reserve = async (input) => {
      order.push("reserve");
      return reserve(input);
    };
    const fetchImpl = vi.fn(async () => {
      order.push("provider");
      return anthropicResponse(1000, 100);
    });
    const result = await giftAdapter(memory.ledger, fetchImpl as never).complete(ask);
    expect(order).toEqual(["reserve", "provider"]);
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 9);
    expect(memory.settled()).toBeCloseTo(result.costUsd, 9);
    expect(memory.spent()).toBeCloseTo(result.costUsd, 9);
  });

  it("refuses with the classified cutoff and never calls the provider once the gift cannot cover a call", async () => {
    const memory = memoryLedger(0.001);
    const fetchImpl = vi.fn(async () => anthropicResponse(10, 10));
    const error = await giftAdapter(memory.ledger, fetchImpl as never).complete(ask).catch((e) => e);
    expect(error).toBeInstanceOf(UsageHardCutoffError);
    expect((error as UsageHardCutoffError).reason).toBe("gift_credit_exhausted");
    expect((error as Error).message).toBe("Your free AI credit from Vantage is used up.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never lets concurrent calls spend more than the gift", async () => {
    // Each call's worst case is about $0.0186 here; $0.10 covers five of them, not twenty.
    const memory = memoryLedger(0.1);
    // Providers report the most a call could cost, the adversarial case for the cap.
    const fetchImpl = vi.fn(async () => anthropicResponse(4000, 1024));
    const adapter = giftAdapter(memory.ledger, fetchImpl as never);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => adapter.complete(ask)));
    const served = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(served).toBeGreaterThan(0);
    expect(served).toBeLessThan(20);
    expect(fetchImpl).toHaveBeenCalledTimes(served);
    expect(memory.spent()).toBeLessThanOrEqual(0.1 + 1e-12);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(UsageHardCutoffError);
    }
  });

  it("releases the hold when the provider refused the call, so nothing is spent", async () => {
    const memory = memoryLedger(10);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(giftAdapter(memory.ledger, fetchImpl as never).complete(ask)).rejects.toBeInstanceOf(ProviderRateLimitError);
    expect(memory.spent()).toBe(0);
  });

  it("counts a timed-out call at its reserved worst case, since it may have been billed", async () => {
    const memory = memoryLedger(10);
    const fetchImpl = vi.fn(async () => {
      throw new ChatUpstreamTimeoutError(50_000);
    });
    await expect(giftAdapter(memory.ledger, fetchImpl as never).complete(ask)).rejects.toBeInstanceOf(ChatUpstreamTimeoutError);
    expect(memory.spent()).toBeGreaterThan(0);
  });

  it("emails the alert the settle fired, through the registered mailer", async () => {
    const ledger: CreditGiftLedger = {
      reserve: async () => ({ holdId: "h1", outcome: "held", amountUsd: 10, spentUsd: 8.1 }),
      settle: async () => "80",
    };
    const mailer = vi.fn(async () => undefined);
    setCreditGiftAlertMailer(mailer);
    await giftAdapter(ledger, vi.fn(async () => anthropicResponse(100, 10)) as never).complete(ask);
    expect(mailer).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1", giftId: "gift-1", alert: "80" });
  });

  it("tells provider refusals (not billed) apart from timeouts and network errors (maybe billed)", () => {
    expect(providerDidNotBill(new ProviderRateLimitError("x", 429))).toBe(true);
    expect(providerDidNotBill(new Error("anthropic chat failed (500 model=x)"))).toBe(true);
    expect(providerDidNotBill(new Error("anthropic API key was rejected (401 model=x). Update the key"))).toBe(true);
    expect(providerDidNotBill(new ChatUpstreamTimeoutError(1000))).toBe(false);
    expect(providerDidNotBill(new TypeError("fetch failed"))).toBe(false);
  });
});

function giftRow(overrides: Record<string, unknown> = {}) {
  return {
    giftId: "gift-1",
    family: "claude",
    amountUsd: "10",
    spentUsd: "0",
    expiresAt: null,
    keySource: "env",
    keyEnv: "ANTHROPIC_API_KEY",
    vaultProvider: null,
    keyCiphertext: null,
    keyNonce: null,
    keyAuthTag: null,
    encryptedDek: null,
    kmsKeyId: null,
    ...overrides,
  };
}

describe("resolveCreditGiftAdapter", () => {
  const base = {
    orgId: "org-1",
    userId: "user-1",
    promptCachingEnabled: true,
    decryptVault: async () => "sk-vault",
    env: { ANTHROPIC_API_KEY: "sk-ant-env" },
  };

  it("builds the gift adapter from the operator's env key, Opus for hard asks", async () => {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        return { rows: [giftRow()], rowCount: 1 };
      }),
    };
    const routing = await resolveCreditGiftAdapter(client as never, { ...base, usableOnly: true, difficulty: "hard" });
    expect(routing?.adapter.model).toBe("claude-opus-5-5");
    expect(sqls[0]).toContain("ai_credit_gift_for_org($1::uuid)");
  });

  it("skips a used-up gift when other free AI may answer, but keeps it for the refusal", async () => {
    const client = { query: vi.fn(async () => ({ rows: [giftRow({ spentUsd: "9.99" })], rowCount: 1 })) };
    expect(await resolveCreditGiftAdapter(client as never, { ...base, usableOnly: true })).toBeNull();
    expect(await resolveCreditGiftAdapter(client as never, { ...base, usableOnly: false })).not.toBeNull();
  });

  it("does nothing without a signed-in member or a usable key", async () => {
    const client = { query: vi.fn(async () => ({ rows: [giftRow()], rowCount: 1 })) };
    expect(await resolveCreditGiftAdapter(client as never, { ...base, userId: undefined, usableOnly: true })).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
    expect(await resolveCreditGiftAdapter(client as never, { ...base, env: {}, usableOnly: true })).toBeNull();
  });
});

describe("resolveOrgChatAdapterWithProvenance with a gift", () => {
  it("uses the gift after the team's own keys and says so in provenance", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-operator";
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM org_billing")) return { rows: [{ tier: "free", giftsReady: true }], rowCount: 1 };
        if (sql.includes("FROM ai_credit_gift_for_org")) return { rows: [giftRow()], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    try {
      const resolved = await resolveOrgChatAdapterWithProvenance(client as never, {
        orgId: "org-1",
        userId: "user-1",
        promptCachingEnabled: true,
        feature: "chat",
        creditGiftLedger: memoryLedger(10).ledger,
      });
      expect(resolved.adapter).toBeInstanceOf(CreditGiftChatAdapter);
      expect(resolved.provenance).toMatchObject({ provider: "anthropic", modelId: "claude-sonnet-5-5", source: "gift" });
      // The team's own keys were looked at first.
      const keys = queries.findIndex((sql) => sql.includes("org_llm_keys"));
      const gift = queries.findIndex((sql) => sql.includes("FROM ai_credit_gift_for_org"));
      expect(keys).toBeGreaterThanOrEqual(0);
      expect(gift).toBeGreaterThan(keys);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("leaves the chain untouched on a database without migration 0727", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM org_billing")) return { rows: [{ tier: "free", giftsReady: false }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    await expect(
      resolveOrgChatAdapterWithProvenance(client as never, { orgId: "org-1", userId: "user-1", promptCachingEnabled: true }),
    ).rejects.toThrow(/No AI provider key is configured/);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("FROM ai_credit_gift_for_org"))).toBe(false);
  });
});
