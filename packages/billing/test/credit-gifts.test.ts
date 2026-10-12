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
  giftEnvKeyNames,
  isAllowedGiftEnvKey,
  meteredAI,
  noteServedKey,
  reservationUsd,
  resolvePoolKeySecret,
  sendCreditGiftAlertEmail,
  setCreditGiftAlertMailer,
  teamCreditGiftLine,
  usdToMicrosCeil,
  UsageHardCutoffError,
  type GiftPoolKey,
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
    const haiku = creditGiftModelFor("claude");
    // 10,000 bytes + 1,024 framing tokens at the $0.125 cache-write rate, 1,024 output at $0.50.
    const ceiling = giftCallCeilingUsd({ inputBytes: 10_000, maxOutputTokens: 1024, prices: haiku.prices });
    expect(ceiling).toBeCloseTo((11_024 * 0.125 + 1024 * 0.5) / 1e6, 6);
    // The bound is above what the same call costs at list price with every byte a token.
    expect(ceiling).toBeGreaterThan((10_000 * 0.1 + 1024 * 0.5) / 1e6);
  });

  it("uses Claude Haiku 5.5 for every ask: Medium effort everyday, High for hard ones", () => {
    expect(creditGiftModelFor("claude")).toMatchObject({ modelId: "claude-haiku-5-5", effort: "medium" });
    expect(creditGiftModelFor("claude", "hard")).toMatchObject({ modelId: "claude-haiku-5-5", effort: "high" });
    expect(CREDIT_GIFT_FAMILIES.claude.models.map((m) => m.prices.inputPerMillionUsd)).toEqual([0.1, 0.1]);
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

  it("lists the provider-key env names a pool row may use, standard and extra", () => {
    expect(
      giftEnvKeyNames("claude", { VANTAGE_GIFT_ANTHROPIC_SPARE: "x", VANTAGE_GIFT_OPENAI_ONE: "y", BETTER_AUTH_SECRET: "z" }),
    ).toEqual(["ANTHROPIC_API_KEY", "VANTAGE_GIFT_ANTHROPIC_SPARE"]);
  });

  it("resolves each pool key server-side and refuses a disallowed env name", async () => {
    const envKey: GiftPoolKey = { keyId: "k1", label: "Main", keyEnv: "ANTHROPIC_API_KEY", envelope: null };
    const sealed: GiftPoolKey = {
      keyId: "k2",
      label: "Spare",
      keyEnv: null,
      envelope: { keyCiphertext: "c", keyNonce: "n", keyAuthTag: "t", encryptedDek: "d", kmsKeyId: "k" },
    };
    const decrypt = vi.fn(async () => " sk-vault ");
    expect(await resolvePoolKeySecret("claude", envKey, decrypt, { ANTHROPIC_API_KEY: " sk-1 " })).toBe("sk-1");
    expect(await resolvePoolKeySecret("claude", { ...envKey, keyEnv: "BETTER_AUTH_SECRET" }, decrypt, { BETTER_AUTH_SECRET: "x" })).toBeNull();
    expect(await resolvePoolKeySecret("claude", envKey, decrypt, {})).toBeNull();
    expect(await resolvePoolKeySecret("claude", sealed, decrypt, {})).toBe("sk-vault");
    expect(await resolvePoolKeySecret("claude", sealed, async () => { throw new Error("KMS key mismatch"); }, {})).toBeNull();
    expect(decrypt).toHaveBeenCalledTimes(1);
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

  it("settles with the key that answered and reports only the alerts the database fired", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return { rows: [{ alert: "exhausted" }], rowCount: 1 };
      },
    } as unknown as PoolClient;
    const ledger = createCreditGiftLedger({ userId: "u", orgId: "o" }, (work) => work(client));
    expect(
      await ledger.settle({ holdId: "h", costUsd: 0.5, promptTokens: 1, completionTokens: 2, released: false, keyId: "k2" }),
    ).toBe("exhausted");
    expect(calls[0]!.params).toEqual(["h", "0.500000", 1, 2, false, "k2"]);
    await ledger.noteKeyFailure({ giftId: "g", keyId: "k1", reason: "Rate limited by the provider (429)" });
    expect(calls[1]!.sql).toContain("note_platform_key_failure($1::uuid, $2::uuid, $3::text)");
    expect(calls[1]!.params).toEqual(["g", "k1", "Rate limited by the provider (429)"]);
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
  it("records which key answered, by id and label, never the secret", async () => {
    const inserts: unknown[][] = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: true }], rowCount: 1 };
        if (sql.includes("INSERT INTO ai_usage_events")) inserts.push(params ?? []);
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{ tier: "free", credit_cap_usd: "0", kill_switch: false, period_start: new Date("2026-01-01"), period_end: new Date("2027-01-01") }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "served-key",
      estimatedCostUsd: 0.01,
      provider: CREDIT_GIFT_PROVIDER,
      model: "claude-sonnet-5-5",
      invoke: async () => {
        // What the key-failover adapter does when the second key answers.
        noteServedKey({ id: "k2", label: "Spare", scope: "platform" });
        return { value: "ok", promptTokens: 1, completionTokens: 1, costUsd: 0.001, model: "claude-sonnet-5-5", provider: "anthropic" };
      },
    });
    const metadata = JSON.parse(String(inserts[0]![11]));
    expect(metadata.servedKey).toEqual({ id: "k2", label: "Spare", scope: "platform" });
    expect(JSON.stringify(inserts[0])).not.toMatch(/sk-/);
  });

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
