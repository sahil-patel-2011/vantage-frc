import { describe, expect, it } from "vitest";
import { expireTrials, evaluateManagedUsage, processStripeEvent } from "../src";
import type { PoolClient } from "@neondatabase/serverless";
import type Stripe from "stripe";

describe("managed allowance and opt-in PAYG", () => {
  const base = {
    includedRemainingUsd: 1,
    estimatedCostUsd: 0.2,
    paygOnly: false,
    paygEnabled: false,
    prepaidBalanceUsd: 0,
    overageUsedUsd: 0,
    overageSpendCapUsd: 0,
    killSwitch: false,
  };
  it("uses included allowance without overage", () => {
    expect(evaluateManagedUsage(base)).toMatchObject({ allowed: true, bucket: "included" });
  });
  it("never lets PAYG-only models consume included allowance", () => {
    expect(evaluateManagedUsage({ ...base, paygOnly: true })).toMatchObject({
      allowed: false,
      reason: "payg_not_enabled",
    });
  });
  it("enforces prepaid balance, spend cap, and kill switch", () => {
    expect(evaluateManagedUsage({ ...base, includedRemainingUsd: 0, paygEnabled: true, prepaidBalanceUsd: 1, overageSpendCapUsd: 1 })).toMatchObject({ bucket: "payg" });
    expect(evaluateManagedUsage({ ...base, killSwitch: true })).toMatchObject({ allowed: false, reason: "kill_switch" });
    expect(evaluateManagedUsage({ ...base, includedRemainingUsd: 0, paygEnabled: true, prepaidBalanceUsd: 0 })).toMatchObject({ reason: "insufficient_prepaid_balance" });
  });
});

describe("Stripe and trial ledgers", () => {
  it("idempotently ignores an already claimed webhook event", async () => {
    const client = { query: async () => ({ rowCount: 0, rows: [] }) } as unknown as PoolClient;
    const result = await processStripeEvent(client, {
      id: "evt_repeat",
      type: "checkout.session.completed",
      data: { object: {} },
    } as unknown as Stripe.Event);
    expect(result).toEqual({ duplicate: true });
  });

  it("expires trials against an injected deterministic clock", async () => {
    const calls: unknown[][] = [];
    const client = {
      query: async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        if (sql.startsWith("UPDATE org_entitlements"))
          return { rowCount: 1, rows: [{ orgId: "org", planCode: "managed_20" }] };
        return { rowCount: 1, rows: [] };
      },
    } as unknown as PoolClient;
    const now = new Date("2026-07-15T12:00:00Z");
    expect(await expireTrials(client, now)).toBe(1);
    expect(calls[0]?.[1]).toEqual([now]);
  });
});
