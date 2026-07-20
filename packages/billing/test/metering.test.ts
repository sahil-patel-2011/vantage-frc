import type { PoolClient } from "@neondatabase/serverless";
import { CommitAndThrowError } from "@vantage/db";
import { describe, expect, it, vi } from "vitest";
import {
  UsageHardCutoffError,
  classifyMeteredAiError,
  meteredAI,
  meteredAiErrorBody,
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
) {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
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
  return { client, queries };
}

function unwrapCutoff(error: unknown): UsageHardCutoffError {
  if (error instanceof CommitAndThrowError && error.publicError instanceof UsageHardCutoffError) {
    return error.publicError;
  }
  if (error instanceof UsageHardCutoffError) return error;
  throw error;
}

describe("serialized AI metering", () => {
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
    const invoke = vi.fn(async (source: "platform" | "byo" | "local" | "local_cli") => ({
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

  it("locks, invokes, and appends the usage ledger", async () => {
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
    expect(queries[0]).toContain("FOR UPDATE");
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
    const invoke = vi.fn(async (source: "platform" | "byo" | "local" | "local_cli") => ({
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
    const invoke = vi.fn(async (source: "platform" | "byo" | "local" | "local_cli") => ({
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
    const invoke = vi.fn(async (source: "platform" | "byo" | "local" | "local_cli") => ({
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
});
