import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  CREDIT_GIFT_FAMILIES,
  CREDIT_GIFT_PROVIDER,
  classifyMeteredAiError,
  createCreditGiftLedger,
  creditGiftModelFor,
  evaluateGiftReservation,
  formatGiftUsd,
  giftCallCeilingUsd,
  isAllowedGiftEnvKey,
  listGiftFundingKeys,
  meteredAI,
  reservationUsd,
  resolveCreditGiftKey,
  sendCreditGiftAlertEmail,
  setCreditGiftAlertMailer,
  teamCreditGiftLine,
  usdToMicrosCeil,
  UsageHardCutoffError,
  type ActiveCreditGift,
} from "../src";

describe("gift cap arithmetic", () => {
  it("allows a reservation that lands exactly on the cap and refuses one micro-dollar more", () => {
    expect(evaluateGiftReservation({ amountUsd: 10, spentUsd: 9.75, requestUsd: 0.25 })).toMatchObject({
      allowed: true,
      spentAfterUsd: 10,
    });
    expect(evaluateGiftReservation({ amountUsd: 10, spentUsd: 9.75, requestUsd: 0.250001 }).allowed).toBe(false);
    expect(evaluateGiftReservation({ amountUsd: 10, spentUsd: 10, requestUsd: 0.000001 }).allowed).toBe(false);
  });

  it("does not drift on binary fractions: ten 0.1 reservations fill a $1 gift exactly", () => {
    let spent = 0;
    let allowed = 0;
    for (let i = 0; i < 11; i += 1) {
      const decision = evaluateGiftReservation({ amountUsd: 1, spentUsd: spent, requestUsd: 0.1 });
      if (decision.allowed) {
        allowed += 1;
        spent = decision.spentAfterUsd;
      }
    }
    expect(allowed).toBe(10);
    expect(spent).toBe(1);
  });

  it("rounds a reservation up to whole micro-dollars, never down", () => {
    expect(usdToMicrosCeil(0.1)).toBe(100_000);
    expect(usdToMicrosCeil(0.0000011)).toBe(2);
    expect(usdToMicrosCeil(0)).toBe(0);
    expect(usdToMicrosCeil(-1)).toBe(0);
    expect(reservationUsd(0.0123451)).toBe(0.012346);
  });

  it("bounds a call by its bytes and output cap at the higher input rate", () => {
    const sonnet = creditGiftModelFor("claude");
    // 10,000 bytes + 1,024 framing tokens at the $2.50 cache-write rate, 1,024 output at $10.
    const ceiling = giftCallCeilingUsd({ inputBytes: 10_000, maxOutputTokens: 1024, prices: sonnet.prices });
    expect(ceiling).toBeCloseTo((11_024 * 2.5 + 1024 * 10) / 1e6, 6);
    // The bound is above what the same call costs at list price with every byte a token.
    expect(ceiling).toBeGreaterThan((10_000 * 2 + 1024 * 10) / 1e6);
  });

  it("uses Sonnet 5.5 for everyday asks and Opus 5.5 for hard ones", () => {
    expect(creditGiftModelFor("claude").modelId).toBe("claude-sonnet-5-5");
    expect(creditGiftModelFor("claude", "hard").modelId).toBe("claude-opus-5-5");
    expect(CREDIT_GIFT_FAMILIES.claude.models.map((m) => m.prices.inputPerMillionUsd)).toEqual([2, 4]);
  });
});

describe("gift funding keys", () => {
  it("only lets a gift read provider-key env names, never another secret", () => {
    expect(isAllowedGiftEnvKey("claude", "ANTHROPIC_API_KEY")).toBe(true);
    expect(isAllowedGiftEnvKey("claude", "VANTAGE_GIFT_ANTHROPIC_TEAM_FUND")).toBe(true);
    expect(isAllowedGiftEnvKey("claude", "OPENAI_API_KEY")).toBe(false);
    expect(isAllowedGiftEnvKey("claude", "BETTER_AUTH_SECRET")).toBe(false);
    expect(isAllowedGiftEnvKey("openai", "DATABASE_ADMIN_URL")).toBe(false);
  });

  it("lists names and whether they are set, never values", () => {
    const keys = listGiftFundingKeys(
      { ANTHROPIC_API_KEY: "sk-ant-secret", VANTAGE_GIFT_ANTHROPIC_SPARE: "sk-ant-2", OPENAI_API_KEY: "" },
      [{ id: "11111111-1111-4111-8111-111111111111", provider: "anthropic", label: "Operator vault" }],
    );
    const claude = keys.filter((key) => key.family === "claude");
    expect(claude.map((key) => key.ref)).toEqual([
      "env:ANTHROPIC_API_KEY",
      "env:VANTAGE_GIFT_ANTHROPIC_SPARE",
      "vault:11111111-1111-4111-8111-111111111111",
    ]);
    expect(keys.find((key) => key.ref === "env:OPENAI_API_KEY")?.configured).toBe(false);
    expect(JSON.stringify(keys)).not.toContain("sk-ant");
  });

  it("resolves the funding key server-side and refuses a disallowed env name", async () => {
    const gift: ActiveCreditGift = {
      giftId: "g",
      family: "claude",
      amountUsd: 10,
      spentUsd: 0,
      expiresAt: null,
      keySource: "env",
      keyEnv: "ANTHROPIC_API_KEY",
      vault: null,
    };
    const decrypt = vi.fn(async () => "never");
    expect(await resolveCreditGiftKey(gift, decrypt, { ANTHROPIC_API_KEY: " sk-1 " })).toBe("sk-1");
    expect(await resolveCreditGiftKey({ ...gift, keyEnv: "BETTER_AUTH_SECRET" }, decrypt, { BETTER_AUTH_SECRET: "x" })).toBeNull();
    expect(await resolveCreditGiftKey(gift, decrypt, {})).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("gift ledger transactions", () => {
  it("sends the reservation rounded up to micro-dollars and reads the outcome", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return { rows: [{ holdId: "h1", outcome: "held", amountUsd: "10", spentUsd: "0.2" }], rowCount: 1 };
      },
    } as unknown as PoolClient;
    let runs = 0;
    const ledger = createCreditGiftLedger({ userId: "u", orgId: "o" }, (work) => {
      runs += 1;
      return work(client);
    });
    const result = await ledger.reserve({ giftId: "g", amountUsd: 0.0123451, model: "claude-sonnet-5-5", feature: "chat" });
    expect(result).toEqual({ holdId: "h1", outcome: "held", amountUsd: 10, spentUsd: 0.2 });
    expect(calls[0]!.sql).toContain("reserve_ai_credit_gift($1::uuid, $2::numeric, $3::text, $4::text)");
    expect(calls[0]!.params).toEqual(["g", "0.012346", "claude-sonnet-5-5", "chat"]);
    // Each reservation is its own committed transaction.
    expect(runs).toBe(1);
  });

  it("reports only the alerts the database fired", async () => {
    const client = {
      async query() {
        return { rows: [{ alert: "exhausted" }], rowCount: 1 };
      },
    } as unknown as PoolClient;
    const ledger = createCreditGiftLedger({ userId: "u", orgId: "o" }, (work) => work(client));
    expect(await ledger.settle({ holdId: "h", costUsd: 0.5, promptTokens: 1, completionTokens: 2, released: false })).toBe("exhausted");
  });
});

describe("gift alerts by email", () => {
  it("is skipped quietly with no mailer, and a failing mailer never throws", async () => {
    setCreditGiftAlertMailer(null);
    await expect(sendCreditGiftAlertEmail({ orgId: "o", userId: "u", giftId: "g", alert: "80" })).resolves.toBeUndefined();
    const mailer = vi.fn(async () => {
      throw new Error("Email isn't set up");
    });
    setCreditGiftAlertMailer(mailer);
    await expect(sendCreditGiftAlertEmail({ orgId: "o", userId: "u", giftId: "g", alert: "exhausted" })).resolves.toBeUndefined();
    expect(mailer).toHaveBeenCalledWith({ orgId: "o", userId: "u", giftId: "g", alert: "exhausted" });
    setCreditGiftAlertMailer(null);
  });
});

describe("gift refusals", () => {
  it("classify as a hard cutoff with the plain message and a link to add a key", () => {
    const classified = classifyMeteredAiError(new UsageHardCutoffError("gift_credit_exhausted"));
    expect(classified).toMatchObject({
      status: 402,
      code: "usage_hard_cutoff",
      reason: "gift_credit_exhausted",
      message: "Your free AI credit from Vantage is used up.",
      cta: { href: "/team/ai-keys" },
    });
    expect(classifyMeteredAiError(new UsageHardCutoffError("gift_credit_ended"))?.message).toBe(
      "Your free AI credit from Vantage has ended.",
    );
  });

  it("formats the team line the way the brief words it", () => {
    expect(teamCreditGiftLine({ totalUsd: 10, usedUsd: 3.2 })).toBe("Vantage gave your team $10 of AI credit · $3.20 used");
    expect(formatGiftUsd(10.5)).toBe("$10.50");
  });
});

describe("meteredAI for a gift-funded call", () => {
  function freeClient() {
    const queries: string[] = [];
    const inserts: unknown[][] = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: true }], rowCount: 1 };
        if (sql.includes("INSERT INTO ai_usage_events")) {
          inserts.push(params ?? []);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{ tier: "free", credit_cap_usd: "0", kill_switch: false, period_start: new Date("2026-01-01"), period_end: new Date("2027-01-01") }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    return { client, queries, inserts };
  }

  it("meters a free team with no keys as `gift` at $0, without asking for a BYO key", async () => {
    const { client, queries, inserts } = freeClient();
    const invoke = vi.fn(async () => ({
      value: "answer",
      promptTokens: 1000,
      completionTokens: 200,
      costUsd: 0.004,
      model: "claude-sonnet-5-5",
      provider: "anthropic",
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "gift-turn",
      estimatedCostUsd: 0.01,
      provider: CREDIT_GIFT_PROVIDER,
      model: "claude-sonnet-5-5",
      invoke,
    });
    expect(result).toBe("answer");
    expect(invoke).toHaveBeenCalledWith("gift");
    // Never looks for BYO keys or the team's hosted allowance: the gift ledger is the cap.
    expect(queries.some((sql) => sql.includes("org_llm_keys"))).toBe(false);
    expect(queries.some((sql) => sql.includes("ai_credit_grants"))).toBe(false);
    const row = inserts[0]!;
    expect(row).toContain("gift");
    expect(row[9]).toBe(0);
    expect(JSON.parse(String(row[11]))).toMatchObject({ fundingMode: "gift", providerCostUsd: 0.004, vantageChargeUsd: 0 });
  });
});
