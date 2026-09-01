import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import {
  RequestCreditsExhaustedError,
  authorizeMeteredAI,
  meteredAI,
  type MeterKeySource,
  type MeteredAIInput,
} from "../src";

type Recorded = { sql: string; params: unknown[] };

/**
 * `credits` null models an org that was never granted any — the normal case, which must
 * behave exactly as it did before request credits existed.
 */
function client(opts: {
  tier?: "free" | "team";
  credits?: { granted: number; spent: number } | null;
  chatWeight?: number;
  hasPlatformGrant?: boolean;
  hasByok?: boolean;
}) {
  const queries: Recorded[] = [];
  const onPlan = opts.credits != null;
  const impl = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [
            {
              tier: opts.tier ?? "team",
              credit_cap_usd: "1000",
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM org_llm_keys")) {
        return opts.hasByok ? { rows: [{ n: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM ai_request_credit_ledger")) {
        return { rows: [{ exists: onPlan }], rowCount: 1 };
      }
      if (sql.includes("FROM ai_credit_weights")) {
        return { rows: [{ request_kind: "chat", credits: opts.chatWeight ?? 1 }], rowCount: 1 };
      }
      if (sql.includes("FROM org_ai_request_credits")) {
        const granted = opts.credits?.granted ?? 0;
        const spent = opts.credits?.spent ?? 0;
        return {
          rows: [{ granted: String(granted), spent: String(spent), balance: String(granted - spent) }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM org_ai_access_grants")) {
        return { rows: [{ exists: opts.hasPlatformGrant === true }], rowCount: 1 };
      }
      if (sql.includes("COALESCE") && sql.includes("AS used")) {
        return { rows: [{ used: "0", reserved: "0", grants: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: impl as unknown as PoolClient, queries };
}

function input(
  pool: PoolClient,
  overrides: Partial<MeteredAIInput<string>> = {},
): MeteredAIInput<string> {
  return {
    client: pool,
    orgId: "org-1",
    userId: "user-1",
    feature: "chat",
    requestId: "req-1",
    estimatedCostUsd: 0.01,
    invoke: async (keySource: MeterKeySource) => ({
      value: "ok",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.01,
      model: "m",
      provider: "p",
      keySource,
    }),
    ...overrides,
  };
}

const sqlOf = (queries: Recorded[], needle: string) =>
  queries.filter((q) => q.sql.includes(needle));
const consumption = (queries: Recorded[]) =>
  queries.filter(
    (q) => q.sql.includes("INSERT INTO ai_request_credit_ledger") && q.sql.includes("consumption"),
  );

describe("request credits on the metering path", () => {
  it("charges nothing for an org that was never granted credits", async () => {
    const { client: pool, queries } = client({ credits: null });
    await meteredAI(input(pool));
    // Absence of a grant means "not on the credit plan", never "out of credits".
    expect(consumption(queries)).toHaveLength(0);
    expect(sqlOf(queries, "INSERT INTO ai_usage_events")).toHaveLength(1);
  });

  it("spends one credit for a chat request and records it once", async () => {
    const { client: pool, queries } = client({ credits: { granted: 50, spent: 3 } });
    await meteredAI(input(pool));

    const [charged] = consumption(queries);
    expect(charged).toBeDefined();
    // Negative because the ledger is signed: grants positive, consumption negative.
    expect(charged?.params).toContain(-1);
    expect(charged?.params).toContain("req-1");
    // Same idempotency key as the usage event, so a retry cannot double-charge.
    expect(charged?.sql).toContain("ON CONFLICT (request_id) DO NOTHING");
  });

  it("weights an agentic run above a single chat turn", async () => {
    const { client: pool, queries } = client({ credits: { granted: 50, spent: 0 } });
    await meteredAI(input(pool, { feature: "agent" }));
    const [charged] = consumption(queries);
    // Default agentic weight is 4; the point of the weights table is that a fan-out
    // loop costs more than one prompt.
    expect(charged?.params).toContain(-4);
  });

  it("refuses the call before invoking when the balance cannot cover it", async () => {
    const { client: pool, queries } = client({ credits: { granted: 5, spent: 5 } });
    let invoked = false;
    await expect(
      meteredAI(
        input(pool, {
          invoke: async () => {
            invoked = true;
            throw new Error("must not reach the provider");
          },
        }),
      ),
    ).rejects.toThrow(RequestCreditsExhaustedError);
    expect(invoked).toBe(false);
    expect(sqlOf(queries, "INSERT INTO ai_usage_events")).toHaveLength(0);
  });

  it("leaves a team's own key alone", async () => {
    const { client: pool, queries } = client({
      credits: { granted: 50, spent: 0 },
      hasByok: true,
    });
    const auth = await authorizeMeteredAI(input(pool));
    // Granted credits fund hosted AI. A team paying its own provider must not burn them.
    expect(auth.keySource).toBe("byo");
    expect(auth.requestCredits).toBe(0);
    expect(consumption(queries)).toHaveLength(0);
  });

  it("does not record consumption for a call that never settled", async () => {
    const { client: pool, queries } = client({ credits: { granted: 50, spent: 0 } });
    const auth = await authorizeMeteredAI(input(pool));
    expect(auth.requestCredits).toBe(1);
    // Authorize only reserves the right to spend; the ledger row is a settle concern.
    expect(consumption(queries)).toHaveLength(0);
  });

  it("charges a free request kind nothing", async () => {
    const { client: pool, queries } = client({ credits: { granted: 50, spent: 0 } });
    await meteredAI(input(pool, { feature: "embedding" }));
    expect(consumption(queries)).toHaveLength(0);
  });
});

describe("platform-granted AI as a funding source", () => {
  it("lets a free team use AI the platform lent it", async () => {
    const { client: pool } = client({ tier: "free", credits: null, hasPlatformGrant: true });
    const auth = await authorizeMeteredAI(input(pool));
    // Before 0518 this threw "Free organizations must configure a BYO AI key", so the
    // relay grant resolved an adapter that metering then refused to let anyone use.
    expect(auth.keySource).toBe("platform_grant");
  });

  it("still refuses a free team with no key, no promo, and no grant", async () => {
    const { client: pool } = client({ tier: "free", credits: null, hasPlatformGrant: false });
    await expect(authorizeMeteredAI(input(pool))).rejects.toThrow(/BYO AI key/);
  });

  it("bills granted AI at zero dollars but does spend credits", async () => {
    const { client: pool, queries } = client({
      tier: "free",
      credits: { granted: 10, spent: 0 },
      hasPlatformGrant: true,
    });
    await meteredAI(input(pool));

    const [usage] = sqlOf(queries, "INSERT INTO ai_usage_events");
    // The relay or platform account paid the provider, so the org's USD ledger is 0 —
    // the request-credit ledger is the budget that actually applies.
    expect(usage?.params).toContain(0);
    expect(consumption(queries)).toHaveLength(1);
  });
});
