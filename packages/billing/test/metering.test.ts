import type { PoolClient } from "@neondatabase/serverless";
import { CommitAndThrowError } from "@vantage/db";
import { describe, expect, it, vi } from "vitest";
import {
  UsageHardCutoffError,
  DuplicateMeteredRequestError,
  classifyMeteredAiError,
  meteredAI,
  meteredAiErrorBody,
  orgBillingLockKey,
  settleCreditDebit,
  type MeterKeySource,
} from "../src";

function paidClient(
  used: number,
  cap: number,
  grants = 0,
  policy?: {
    payg_enabled?: boolean;
    prepaid_balance_usd?: string;
    overage_spend_cap_usd?: string;
    kill_switch?: boolean;
  },
  /** false models another call for the same org already holding the advisory lock. */
  locked = true,
) {
  const queries: string[] = [];
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      queries.push(sql);
      if (sql.includes("INSERT INTO ai_usage_events")) inserts.push({ sql, params: params ?? [] });
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked }], rowCount: 1 };
      }
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [{
            tier: "team",
            credit_cap_usd: String(cap),
            kill_switch: false,
            period_start: new Date("2026-01-01"),
            period_end: new Date("2027-01-01")
          }],
          rowCount: 1
        };
      }
      if (sql.includes("FROM org_usage_policies")) {
        return {
          rows: policy
            ? [{
                payg_enabled: policy.payg_enabled ?? false,
                prepaid_balance_usd: policy.prepaid_balance_usd ?? "0",
                overage_spend_cap_usd: policy.overage_spend_cap_usd ?? "0",
                kill_switch: policy.kill_switch ?? false,
              }]
            : [],
          rowCount: policy ? 1 : 0,
        };
      }
      if (sql.includes("ai_credit_grants") || (sql.includes("COALESCE") && sql.includes("AS used"))) {
        return { rows: [{ used: String(used), grants: String(grants) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  } as unknown as PoolClient;
  return { client, queries, inserts };
}

function unwrapCutoff(error: unknown): UsageHardCutoffError {
  if (error instanceof CommitAndThrowError && error.publicError instanceof UsageHardCutoffError) {
    return error.publicError;
  }
  if (error instanceof UsageHardCutoffError) return error;
  throw error;
}

describe("serialized AI metering", () => {
  it("rejects a completed request id before invoking or charging again", async () => {
    const { client: base } = paidClient(1, 10);
    const invoke = vi.fn();
    const client = {
      query(sql: string, params?: unknown[]) {
        if (sql.includes("SELECT id FROM ai_usage_events WHERE request_id")) {
          return Promise.resolve({ rows: [{ id: "usage-1" }], rowCount: 1 });
        }
        return base.query(sql, params);
      },
    } as unknown as PoolClient;
    await expect(
      meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "chat",
        requestId: "same-request",
        estimatedCostUsd: 0.01,
        invoke,
      }),
    ).rejects.toBeInstanceOf(DuplicateMeteredRequestError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("serializes concurrent retries and only invokes the provider once", async () => {
    let held = false;
    let usageCommitted = false;
    let releaseLock: (() => void) | null = null;
    const waiters: Array<() => void> = [];
    const wrap = (base: PoolClient) =>
      ({
        async query(sql: string, params?: unknown[]) {
          if (sql.includes("pg_advisory_xact_lock") && !sql.includes("pg_try")) {
            if (held) await new Promise<void>((resolve) => waiters.push(resolve));
            held = true;
            releaseLock = () => {
              held = false;
              waiters.shift()?.();
            };
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("SELECT id FROM ai_usage_events WHERE request_id")) {
            return usageCommitted
              ? { rows: [{ id: "usage-1" }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          const result = await base.query(sql, params);
          if (sql.includes("INSERT INTO ai_usage_events")) {
            usageCommitted = true;
            releaseLock?.();
          }
          return result;
        },
      }) as unknown as PoolClient;
    const firstBase = paidClient(1, 10).client;
    const secondBase = paidClient(1, 10).client;
    let finishProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      finishProvider = resolve;
    });
    const firstInvoke = vi.fn(async (source: MeterKeySource) => {
      await providerGate;
      return {
        value: "first",
        promptTokens: 1,
        completionTokens: 1,
        costUsd: 0.01,
        model: "test",
        provider: "test",
        keySource: source,
      };
    });
    const secondInvoke = vi.fn();
    const first = meteredAI({
      client: wrap(firstBase),
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "concurrent-request",
      estimatedCostUsd: 0.01,
      invoke: firstInvoke,
    });
    await Promise.resolve();
    const second = meteredAI({
      client: wrap(secondBase),
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "concurrent-request",
      estimatedCostUsd: 0.01,
      invoke: secondInvoke,
    });
    await Promise.resolve();
    expect(secondInvoke).not.toHaveBeenCalled();
    finishProvider();
    await expect(first).resolves.toBe("first");
    await expect(second).rejects.toBeInstanceOf(DuplicateMeteredRequestError);
    expect(firstInvoke).toHaveBeenCalledTimes(1);
    expect(secondInvoke).not.toHaveBeenCalled();
  });

  it("does not record a successful charge when provider output validation fails", async () => {
    const { client, inserts } = paidClient(1, 10);
    await expect(
      meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "bugbot_ultra",
        requestId: "invalid-bugbot-diff",
        estimatedCostUsd: 2,
        keySource: "platform",
        invoke: async () => {
          throw new Error("Bugbot did not return a valid unified diff");
        },
      }),
    ).rejects.toThrow(/valid unified diff/i);
    expect(inserts).toHaveLength(0);
  });

  it("does not record a flat-fee charge when the provider fails", async () => {
    const { client, inserts } = paidClient(1, 10);
    await expect(
      meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "bugbot_ultra",
        requestId: "failed-bugbot-provider",
        estimatedCostUsd: 1,
        keySource: "platform",
        invoke: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow(/provider unavailable/i);
    expect(inserts).toHaveLength(0);
  });

  it("hard-stops when included allowance is exhausted and PAYG is off", async () => {
    const { client } = paidClient(9.5, 10);
    const invoke = vi.fn();
    await expect(meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "request",
      estimatedCostUsd: 0.51,
      invoke
    })).rejects.toSatisfy((error: unknown) => unwrapCutoff(error) instanceof UsageHardCutoffError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("hard-stops with payg_not_enabled reason for Soft-UI CTAs", async () => {
    const { client } = paidClient(10, 10);
    try {
      await meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "chat",
        requestId: "request-cutoff",
        estimatedCostUsd: 0.01,
        invoke: async () => {
          throw new Error("should not invoke");
        },
      });
      expect.unreachable("expected hard cutoff");
    } catch (error) {
      const cutoff = unwrapCutoff(error);
      expect(cutoff.reason).toBe("payg_not_enabled");
      const classified = classifyMeteredAiError(error);
      expect(classified).toMatchObject({
        status: 402,
        code: "usage_hard_cutoff",
        reason: "payg_not_enabled",
      });
      expect(classified).not.toHaveProperty("hardCutoff");
      expect(meteredAiErrorBody(classified!)).toMatchObject({
        code: "usage_hard_cutoff",
        reason: "payg_not_enabled",
        hardCutoff: true,
      });
    }
  });

  it("does not treat admin grants as silent included overage without PAYG", async () => {
    // Grants count as prepaid credits, not an expanded included cap.
    const { client } = paidClient(10, 10, 5);
    const invoke = vi.fn(async (source: MeterKeySource) => ({
      value: "ok",
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.4,
      model: "test",
      provider: "test",
      keySource: source,
    }));
    // Estimate within grant balance → allowed via prepaid path (explicit credits, not silent overage).
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "request-grants",
      estimatedCostUsd: 0.5,
      invoke: invoke as never,
    });
    expect(result).toBe("ok");
    expect(invoke).toHaveBeenCalled();
  });

  it("allows PAYG when prepaid balance and spend cap cover the estimate", async () => {
    const { client } = paidClient(10, 10, 0, {
      payg_enabled: true,
      prepaid_balance_usd: "5",
      overage_spend_cap_usd: "20",
    });
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "writer",
      requestId: "request-payg",
      estimatedCostUsd: 0.25,
      invoke: async (source) => ({
        value: "ok",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.2,
        model: "test",
        provider: "test",
        keySource: source,
      }),
    });
    expect(result).toBe("ok");
  });

  it("hard-stops PAYG at the spend cap", async () => {
    const { client } = paidClient(10, 10, 0, {
      payg_enabled: true,
      prepaid_balance_usd: "50",
      overage_spend_cap_usd: "0.1",
    });
    const invoke = vi.fn();
    try {
      await meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "research",
        requestId: "request-cap",
        estimatedCostUsd: 0.5,
        invoke,
      });
      expect.unreachable("expected spend_cap cutoff");
    } catch (error) {
      expect(unwrapCutoff(error).reason).toBe("spend_cap");
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("takes the advisory lock, invokes, and appends the usage ledger", async () => {
    const { client, queries } = paidClient(1, 10);
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "request",
      estimatedCostUsd: 0.25,
      invoke: async (source) => ({
        value: "brief",
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.2,
        model: "test-model",
        provider: "test-provider",
        keySource: source
      })
    });
    expect(result).toBe("brief");
    expect(queries[0]).toContain("pg_advisory_xact_lock");
    expect(queries.some((query) => query.includes("pg_try_advisory_xact_lock"))).toBe(true);
    // The org_billing read must not hold a row lock across input.invoke().
    const billingRead = queries.find((query) => query.includes("FROM org_billing"));
    expect(billingRead).toBeDefined();
    expect(billingRead).not.toContain("FOR UPDATE");
    expect(queries.some((query) => query.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });

  it("records local_cli usage at cost 0 without locking billing credits", async () => {
    const queries: string[] = [];
    const params: unknown[][] = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        queries.push(sql);
        if (values) params.push(values);
        return { rows: [], rowCount: 1 };
      }
    } as unknown as PoolClient;
    const invoke = vi.fn(async (source: MeterKeySource) => ({
      value: { ok: true },
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 99,
      model: "claude-code-cli",
      provider: "local_cli",
      keySource: source
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "cad",
      requestId: "local-cli-request",
      estimatedCostUsd: 0,
      keySource: "local_cli",
      invoke
    });
    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("local_cli");
    expect(queries.some((query) => query.includes("FROM org_billing"))).toBe(false);
    expect(queries.some((query) => query.includes("INSERT INTO ai_usage_events"))).toBe(true);
    expect(queries.some((query) => query.includes("'local_cli'"))).toBe(true);
    const insertParams = params.find((row) => row.includes("cad"));
    expect(insertParams?.includes(0) || queries.some((q) => q.includes("cost_usd") && q.includes(",0,"))).toBe(true);
  });

  it("prefers BYOK on paid tiers and skips hosted credit debit", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{
              tier: "team",
              credit_cap_usd: "10",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM org_provider_configs") && sql.includes("local_relay")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM org_llm_keys")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        if (sql.includes("UNION ALL")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    } as unknown as PoolClient;
    const invoke = vi.fn(async (source: MeterKeySource) => ({
      value: "byok-ok",
      promptTokens: 5,
      completionTokens: 5,
      costUsd: 0.12,
      model: "gpt-4.1-mini",
      provider: "openai",
      keySource: source,
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "byok-paid",
      estimatedCostUsd: 0.12,
      invoke,
    });
    expect(result).toBe("byok-ok");
    expect(invoke).toHaveBeenCalledWith("byo");
    expect(queries.some((q) => q.includes("credit_wallets"))).toBe(false);
    expect(queries.some((q) => q.includes("FROM org_usage_policies"))).toBe(false);
  });

  it("keeps hosted platform metering when no BYOK is configured", async () => {
    const { client } = paidClient(1, 10);
    // paidClient returns empty for org_llm_keys / org_provider_configs → platform path
    const invoke = vi.fn(async (source: MeterKeySource) => ({
      value: "hosted",
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.05,
      model: "test",
      provider: "test",
      keySource: source,
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "hosted-no-byok",
      estimatedCostUsd: 0.05,
      invoke,
    });
    expect(result).toBe("hosted");
    expect(invoke).toHaveBeenCalledWith("platform");
  });

  it("forces hosted platform billing when keySource is platform even if BYOK exists", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{
              tier: "team",
              credit_cap_usd: "20",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM org_usage_policies")) {
          return {
            rows: [{
              payg_enabled: false,
              prepaid_balance_usd: "0",
              overage_spend_cap_usd: "0",
              kill_switch: false,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("ai_credit_grants") || (sql.includes("COALESCE") && sql.includes("AS used"))) {
          return { rows: [{ used: "1", grants: "0" }], rowCount: 1 };
        }
        if (sql.includes("FROM org_llm_keys") || sql.includes("FROM org_provider_configs")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    } as unknown as PoolClient;
    const invoke = vi.fn(async (source: MeterKeySource) => ({
      value: "ultra-ok",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 1,
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      keySource: source,
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "bugbot_ultra",
      requestId: "ultra-scan",
      estimatedCostUsd: 1,
      keySource: "platform",
      invoke,
    });
    expect(result).toBe("ultra-ok");
    expect(invoke).toHaveBeenCalledWith("platform");
    expect(queries.some((q) => q.includes("FROM org_llm_keys"))).toBe(false);
    expect(queries.some((q) => q.includes("INSERT INTO ai_usage_events"))).toBe(true);
  });
});

describe("subscription-bridge metering (0486/0488)", () => {
  function bridgeClient(tier: string) {
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const queries: string[] = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock")) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO ai_usage_events")) {
          inserts.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{
              tier,
              credit_cap_usd: "10",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            }],
            rowCount: 1,
          };
        }
        // No org keys, no policies, no caps configured anywhere.
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    return { client, inserts, queries };
  }

  it("meters a bridge turn for a FREE org with NO keys instead of demanding a BYO key", async () => {
    const { client, inserts } = bridgeClient("free");
    const invoke = vi.fn(async (source: string) => ({
      value: "bridged",
      promptTokens: 812,
      completionTokens: 96,
      costUsd: 0,
      model: "claude-fable-5",
      provider: "subscription-bridge",
      keySource: source,
    }));
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "bridge-turn",
      estimatedCostUsd: 0.01,
      provider: "subscription-bridge",
      model: "claude-code",
      invoke: invoke as never,
    });
    expect(result).toBe("bridged");
    expect(invoke).toHaveBeenCalledWith("subscription_bridge");
    expect(inserts).toHaveLength(1);
    // key_source is param $6-adjacent by position; assert by membership to stay
    // resilient to column order: the recorded row carries the bridge label and $0.
    expect(inserts[0]!.params).toContain("subscription_bridge");
    expect(inserts[0]!.sql).toContain("key_source");
  });

  it("records the fallback's REAL cost and settles it as platform when the bridge fell through", async () => {
    const { client, inserts, queries } = bridgeClient("team");
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "season_report",
      requestId: "bridge-fallback",
      estimatedCostUsd: 0.05,
      provider: "subscription-bridge",
      model: "claude-code",
      invoke: (async () => ({
        value: "report",
        promptTokens: 5000,
        completionTokens: 900,
        costUsd: 0.042,
        model: "claude-sonnet-4-20250514",
        provider: "anthropic",
      })) as never,
    });
    expect(result).toBe("report");
    expect(inserts).toHaveLength(1);
    // The org has no BYO key, so a hosted Vantage key paid for the fallback: it must
    // settle as platform, not as an external $0 bridge source.
    expect(inserts[0]!.params).toContain("platform");
    expect(inserts[0]!.params).not.toContain("subscription_bridge");
    expect(inserts[0]!.params).toContain(0.042);
    const metadata = JSON.parse(inserts[0]!.params[11] as string) as Record<string, unknown>;
    expect(metadata.settledFrom).toBe("subscription_bridge");
    expect(metadata.vantageChargeUsd).toBeUndefined();
    expect(queries.some((query) => query.includes("UPDATE org_plan_periods"))).toBe(true);
  });

  it("settles a bridge fallback onto the org's own key as byo, with no hosted debit", async () => {
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const queries: string[] = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock")) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO ai_usage_events")) {
          inserts.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{
              tier: "team",
              credit_cap_usd: "10",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM org_llm_keys")) {
          return { rows: [{ "?column?": 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "bridge-fallback-byo",
      estimatedCostUsd: 0.05,
      provider: "subscription-bridge",
      model: "claude-code",
      invoke: (async () => ({
        value: "answer",
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0.003,
        model: "gpt-4.1-mini",
        provider: "openai",
      })) as never,
    });
    expect(result).toBe("answer");
    expect(inserts[0]!.params).toContain("byo");
    expect(queries.some((query) => query.includes("UPDATE org_plan_periods"))).toBe(false);
    expect(queries.some((query) => query.includes("UPDATE credit_wallets"))).toBe(false);
  });
});

describe("org billing advisory lock key", () => {
  it("is deterministic for the same org id", () => {
    expect(orgBillingLockKey("org")).toBe(orgBillingLockKey("org"));
  });

  it("pins known keys so a deploy never moves an org's lock", () => {
    expect(orgBillingLockKey("org")).toBe("-4774160384289562962");
    expect(orgBillingLockKey("11111111-1111-4111-8111-111111111111")).toBe(
      "4964949963939343247",
    );
  });

  it("separates orgs", () => {
    expect(orgBillingLockKey("org-a")).not.toBe(orgBillingLockKey("org-b"));
  });

  it("stays inside the signed 64-bit range Postgres accepts", () => {
    const min = -(2n ** 63n);
    const max = 2n ** 63n - 1n;
    const orgIds = ["", "org", "org-a", "org-b", "z".repeat(200), "11111111-1111-4111-8111-111111111111"];
    for (const orgId of orgIds) {
      const key = BigInt(orgBillingLockKey(orgId));
      expect(key >= min && key <= max).toBe(true);
    }
  });

  it("keeps full 64-bit precision instead of collapsing through Number", () => {
    // Number() would round the key to 53 significant bits and silently collide.
    const key = orgBillingLockKey("org");
    expect(String(BigInt(key))).toBe(key);
    expect(Number.isSafeInteger(Number(key))).toBe(false);
  });
});

describe("unserialized metering (advisory lock already held)", () => {
  it("never blocks on a row lock when another call for the org holds it", async () => {
    // billingOwner is required or readCreditWallet returns before issuing any SQL and
    // the FOR UPDATE assertion below would pass no matter what the code does.
    const { client, queries } = paidClient(1, 10, 0, undefined, false);
    let queriesBeforeInvoke = -1;
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "unserialized",
      billingOwner: { type: "org", id: "org" },
      estimatedCostUsd: 0.25,
      invoke: async (source) => {
        queriesBeforeInvoke = queries.length;
        return {
          value: "brief",
          promptTokens: 10,
          completionTokens: 5,
          costUsd: 0.2,
          model: "test-model",
          provider: "test-provider",
          keySource: source,
        };
      },
    });
    expect(result).toBe("brief");
    // Blocking is only possible on a lock taken BEFORE the provider call, because a
    // row lock lives until commit. The settle-time lock after invoke() is expected.
    expect(queriesBeforeInvoke).toBeGreaterThan(0);
    expect(queries.slice(0, queriesBeforeInvoke).some((q) => q.includes("FOR UPDATE"))).toBe(false);
  });

  it("still hard-stops from committed usage when the cap is already spent", async () => {
    const { client } = paidClient(9.5, 10, 0, undefined, false);
    const invoke = vi.fn();
    await expect(
      meteredAI({
        client,
        orgId: "org",
        userId: "user",
        feature: "research",
        requestId: "unserialized-cutoff",
        estimatedCostUsd: 0.51,
        invoke,
      }),
    ).rejects.toSatisfy((error: unknown) => unwrapCutoff(error) instanceof UsageHardCutoffError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records meteringSerialized:false so owners can see unserialized enforcement", async () => {
    const { client, inserts } = paidClient(1, 10, 0, undefined, false);
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "unserialized-metadata",
      estimatedCostUsd: 0.25,
      invoke: async (source) => ({
        value: "brief",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.2,
        model: "test-model",
        provider: "test-provider",
        keySource: source,
      }),
    });
    const metadata = JSON.parse(inserts[0]!.params[11] as string) as Record<string, unknown>;
    expect(metadata.meteringSerialized).toBe(false);
  });

  it("leaves the common serialized path free of metering noise", async () => {
    const { client, inserts } = paidClient(1, 10);
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "serialized-metadata",
      estimatedCostUsd: 0.25,
      invoke: async (source) => ({
        value: "brief",
        promptTokens: 10,
        completionTokens: 5,
        costUsd: 0.2,
        model: "test-model",
        provider: "test-provider",
        keySource: source,
      }),
    });
    const metadata = JSON.parse(inserts[0]!.params[11] as string) as Record<string, unknown>;
    expect(metadata).not.toHaveProperty("meteringSerialized");
  });
});

describe("settle-time credit debit", () => {
  it("matches allocateCreditDebit when the wallet covers the call", () => {
    const settled = settleCreditDebit({
      included: 27,
      purchased: 0,
      gifted: 0,
      providerCostUsd: 2.5,
      serviceMultiplier: 0.75,
    });
    expect(settled.debit).toBeCloseTo(2.5 * 0.75);
    expect(settled.fromIncluded).toBeCloseTo(1.875);
    expect(settled.shortfallUsd).toBe(0);
    expect(settled.bucket).toBe("included");
  });

  it("never throws for a call the provider already billed and reports the shortfall", () => {
    const settled = settleCreditDebit({
      included: 0.5,
      purchased: 0.25,
      gifted: 0,
      providerCostUsd: 4,
      serviceMultiplier: 0.75,
    });
    expect(settled.owedUsd).toBeCloseTo(3);
    expect(settled.debit).toBeCloseTo(0.75);
    expect(settled.fromIncluded).toBeCloseTo(0.5);
    expect(settled.fromPurchased).toBeCloseTo(0.25);
    expect(settled.shortfallUsd).toBeCloseTo(2.25);
  });

  it("refuses to allocate from a negative balance", () => {
    const settled = settleCreditDebit({
      included: -5,
      purchased: 0,
      gifted: 0,
      providerCostUsd: 1,
      serviceMultiplier: 0.75,
    });
    expect(settled.fromIncluded).toBe(0);
    expect(settled.debit).toBe(0);
    expect(settled.shortfallUsd).toBeCloseTo(0.75);
  });
});

describe("credit wallet settlement inside meteredAI", () => {
  function walletClient(options: {
    locked?: boolean;
    included?: string;
    purchased?: string;
    gifted?: string;
  }) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        if (sql.includes("pg_try_advisory_xact_lock")) {
          return { rows: [{ locked: options.locked ?? true }], rowCount: 1 };
        }
        if (sql.includes("FROM org_billing")) {
          return {
            rows: [{
              tier: "team",
              credit_cap_usd: "10",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM billing_accounts a")) {
          return {
            rows: [{
              accountId: "account",
              included: options.included ?? "0",
              purchased: options.purchased ?? "0",
              gifted: options.gifted ?? "0",
              serviceMultiplier: "0.75",
              termsSnapshot: { featureFlags: {} },
              planCode: "team_pro",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("ai_credit_grants") || (sql.includes("COALESCE") && sql.includes("AS used"))) {
          return { rows: [{ used: "0", grants: "0" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    return { client, calls };
  }

  const findCall = (calls: Array<{ sql: string; params: unknown[] }>, needle: string) =>
    calls.find((call) => call.sql.includes(needle));

  /**
   * The whole point of the restructure: a row lock is held until the caller's
   * transaction commits, so ANY `FOR UPDATE` taken before invoke() pins that row for
   * the entire provider call and stalls every other metered call for the same owner.
   * These two tests pin both halves — nothing locked before, wallet locked after.
   */
  it("takes no row lock at all before the provider call", async () => {
    const { client, calls } = walletClient({ included: "50" });
    let callsBeforeInvoke = -1;
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "wallet-prelock",
      estimatedCostUsd: 0.1,
      keySource: "platform",
      billingOwner: { type: "org", id: "org" },
      invoke: async (source) => {
        callsBeforeInvoke = calls.length;
        return {
          value: "ok",
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0.1,
          model: "test",
          provider: "test",
          keySource: source,
        };
      },
    });
    // The wallet really was read up front (cap check), so this is not vacuous.
    expect(callsBeforeInvoke).toBeGreaterThan(0);
    const beforeInvoke = calls.slice(0, callsBeforeInvoke);
    expect(beforeInvoke.some((call) => call.sql.includes("FROM billing_accounts a"))).toBe(true);
    expect(beforeInvoke.some((call) => call.sql.includes("FOR UPDATE"))).toBe(false);
  });

  it("locks the wallet row only after the provider call, to debit fresh balances", async () => {
    const { client, calls } = walletClient({ included: "50" });
    let callsBeforeInvoke = -1;
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "wallet-settle-lock",
      estimatedCostUsd: 0.1,
      keySource: "platform",
      billingOwner: { type: "org", id: "org" },
      invoke: async (source) => {
        callsBeforeInvoke = calls.length;
        return {
          value: "ok",
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0.1,
          model: "test",
          provider: "test",
          keySource: source,
        };
      },
    });
    const afterInvoke = calls.slice(callsBeforeInvoke);
    const settleRead = afterInvoke.find((call) => call.sql.includes("FROM billing_accounts a"));
    expect(settleRead?.sql).toContain("FOR UPDATE OF w");
    // and the debit is applied from that locked read
    expect(afterInvoke.some((call) => call.sql.includes("UPDATE credit_wallets"))).toBe(true);
  });

  it("still debits without the advisory lock, and still locks the row only at settle", async () => {
    const { client, calls } = walletClient({ included: "50", locked: false });
    let callsBeforeInvoke = -1;
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "wallet-unserialized",
      estimatedCostUsd: 0.1,
      keySource: "platform",
      billingOwner: { type: "org", id: "org" },
      invoke: async (source) => {
        callsBeforeInvoke = calls.length;
        return {
          value: "ok",
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0.1,
          model: "test",
          provider: "test",
          keySource: source,
        };
      },
    });
    expect(calls.slice(0, callsBeforeInvoke).some((c) => c.sql.includes("FOR UPDATE"))).toBe(false);
    expect(
      calls.slice(callsBeforeInvoke).find((c) => c.sql.includes("FROM billing_accounts a"))?.sql,
    ).toContain("FOR UPDATE OF w");
  });

  it("records the usage event with a shortfall instead of throwing after the call", async () => {
    const { client, calls } = walletClient({ included: "0.01" });
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "wallet-shortfall",
      estimatedCostUsd: 0.01,
      keySource: "platform",
      billingOwner: { type: "org", id: "org" },
      invoke: async (source) => ({
        value: "expensive",
        promptTokens: 10,
        completionTokens: 10,
        // The provider billed far more than the estimate reserved.
        costUsd: 4,
        model: "test",
        provider: "test",
        keySource: source,
      }),
    });
    expect(result).toBe("expensive");
    const usageEvent = findCall(calls, "INSERT INTO ai_usage_events");
    expect(usageEvent).toBeDefined();
    const metadata = JSON.parse(usageEvent!.params[11] as string) as Record<string, number>;
    expect(metadata.creditShortfallUsd).toBeCloseTo(2.99);
    expect(findCall(calls, "UPDATE credit_wallets")?.params[1]).toBeCloseTo(0.01);
    expect(findCall(calls, "INSERT INTO credit_ledger")?.params[1]).toBeCloseTo(-0.01);
  });

  it("never credits the wallet back when a concurrent overshoot left it negative", async () => {
    const { client, calls } = walletClient({ included: "-5", locked: false });
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "research",
      requestId: "wallet-negative",
      estimatedCostUsd: 0,
      keySource: "platform",
      billingOwner: { type: "org", id: "org" },
      invoke: async (source) => ({
        value: "ok",
        promptTokens: 1,
        completionTokens: 1,
        costUsd: 1,
        model: "test",
        provider: "test",
        keySource: source,
      }),
    });
    expect(findCall(calls, "UPDATE credit_wallets")?.params[1]).toBe(0);
    const metadata = JSON.parse(
      findCall(calls, "INSERT INTO ai_usage_events")!.params[11] as string,
    ) as Record<string, number>;
    expect(metadata.creditShortfallUsd).toBeCloseTo(0.75);
  });

  it("debits the wallet when a bridge fallback settles onto a hosted key", async () => {
    const { client, calls } = walletClient({ included: "50" });
    const result = await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "season_report",
      requestId: "bridge-fallback-wallet",
      estimatedCostUsd: 0.05,
      provider: "subscription-bridge",
      model: "claude-code",
      billingOwner: { type: "org", id: "org" },
      invoke: (async () => ({
        value: "report",
        promptTokens: 5000,
        completionTokens: 900,
        costUsd: 0.4,
        model: "claude-sonnet-4-20250514",
        provider: "anthropic",
      })) as never,
    });
    expect(result).toBe("report");
    expect(findCall(calls, "UPDATE credit_wallets")?.params[1]).toBeCloseTo(0.3);
    expect(findCall(calls, "INSERT INTO credit_ledger")?.params[1]).toBeCloseTo(-0.3);
    expect(findCall(calls, "UPDATE org_plan_periods")).toBeDefined();
  });

  it("leaves a genuinely bridged turn free of any hosted debit", async () => {
    const { client, calls } = walletClient({ included: "50" });
    await meteredAI({
      client,
      orgId: "org",
      userId: "user",
      feature: "chat",
      requestId: "bridge-real",
      estimatedCostUsd: 0.05,
      provider: "subscription-bridge",
      model: "claude-code",
      billingOwner: { type: "org", id: "org" },
      invoke: (async () => ({
        value: "bridged",
        promptTokens: 100,
        completionTokens: 20,
        costUsd: 0,
        model: "claude-fable-5",
        provider: "subscription-bridge",
      })) as never,
    });
    expect(findCall(calls, "UPDATE credit_wallets")).toBeUndefined();
    expect(findCall(calls, "UPDATE org_plan_periods")).toBeUndefined();
  });
});
