import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { CreditCapExceededError, meteredAI } from "../src";

function paidClient(used: number, cap: number, grants = 0) {
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
      if (sql.includes("COALESCE")) {
        return { rows: [{ used: String(used), grants: String(grants) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  } as unknown as PoolClient;
  return { client, queries };
}

describe("serialized AI metering", () => {
  it("rejects estimated spend over the cap before invoking a provider", async () => {
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
    })).rejects.toBeInstanceOf(CreditCapExceededError);
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
    const invoke = vi.fn(async (source: "platform" | "byo" | "local_cli") => ({
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
});
