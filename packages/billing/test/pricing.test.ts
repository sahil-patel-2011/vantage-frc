import { describe, expect, it } from "vitest";
import {
  allocateCreditDebit,
  CreditCapExceededError,
  DEFAULT_SERVICE_MULTIPLIER,
  expireTrials,
  evaluateEntitlement,
  evaluateFreeManagedUsage,
  evaluateManagedUsage,
  isPlanPeriodActive,
  processStripeEvent,
  PRICING_CATALOG,
  CATALOG_SERVICE_MULTIPLIER,
  BYOK_LIST_MULTIPLIER,
  hostedApiSavingsCopy,
  hostedApiEconomicsSoftLine,
  hostedCreditPackListApiUsd,
  raisedPricingStrip,
  raisedPricingSummaryLine,
} from "../src";
import type { PoolClient } from "@neondatabase/serverless";
import type Stripe from "stripe";

describe("appealing pricing catalog", () => {
  it("keeps Soft-UI / ops ladder and 0.75× hosted credits aligned", () => {
    expect(CATALOG_SERVICE_MULTIPLIER).toBe(0.75);
    expect(DEFAULT_SERVICE_MULTIPLIER).toBe(0.75);
    expect(BYOK_LIST_MULTIPLIER).toBe(1);
    expect(PRICING_CATALOG.access.monthlyUsd).toBe(69);
    expect(PRICING_CATALOG.individual_pro).toMatchObject({ monthlyUsd: 109, includedAllowanceUsd: 75 });
    expect(PRICING_CATALOG.individual_max).toMatchObject({ monthlyUsd: 159, includedAllowanceUsd: 130 });
    expect(PRICING_CATALOG.team_pro).toMatchObject({ monthlyUsd: 299, includedAllowanceUsd: 225 });
    expect(PRICING_CATALOG.team_max).toMatchObject({ monthlyUsd: 549, includedAllowanceUsd: 450 });
    expect(PRICING_CATALOG.team_trial.includedAllowanceUsd).toBe(39);
    expect(raisedPricingStrip().map((p) => p.price)).toEqual(["$0", "$109 / $159", "$299 / $549"]);
    expect(raisedPricingSummaryLine()).toMatch(/Free \$0/);
    expect(hostedApiSavingsCopy()).toMatch(/Credits go further/i);
    expect(hostedApiEconomicsSoftLine()).toMatch(/25% less/);
    expect(hostedCreditPackListApiUsd(100)).toBe(133);
  });
});

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
  it("hard-stops when included allowance is exhausted and PAYG is off", () => {
    expect(
      evaluateManagedUsage({ ...base, includedRemainingUsd: 0, paygEnabled: false, prepaidBalanceUsd: 0 }),
    ).toMatchObject({ allowed: false, reason: "payg_not_enabled" });
  });
  it("allows prepaid Usage Credits without PAYG enrollment (no silent overage)", () => {
    expect(
      evaluateManagedUsage({ ...base, includedRemainingUsd: 0, paygEnabled: false, prepaidBalanceUsd: 1 }),
    ).toMatchObject({ allowed: true, bucket: "prepaid" });
  });
  it("hard-stops PAYG at the overage spend cap even when prepaid remains", () => {
    expect(
      evaluateManagedUsage({
        ...base,
        includedRemainingUsd: 0,
        paygEnabled: true,
        prepaidBalanceUsd: 10,
        overageUsedUsd: 0.9,
        overageSpendCapUsd: 1,
        estimatedCostUsd: 0.2,
      }),
    ).toMatchObject({ allowed: false, reason: "spend_cap" });
  });
});

describe("0.75× hosted usage credit debit (~25% vs BYOK)", () => {
  it("defaults the service multiplier to 0.75 for hosted list discount", () => {
    expect(DEFAULT_SERVICE_MULTIPLIER).toBe(0.75);
    expect(DEFAULT_SERVICE_MULTIPLIER).toBe(CATALOG_SERVICE_MULTIPLIER);
  });

  it("debits provider list cost at 0.75× as Usage Credits", () => {
    const allocation = allocateCreditDebit({
      included: 27,
      purchased: 0,
      gifted: 0,
      providerCostUsd: 2.5,
      serviceMultiplier: DEFAULT_SERVICE_MULTIPLIER,
    });
    expect(allocation.debit).toBeCloseTo(2.5 * 0.75);
    expect(allocation.fromIncluded).toBeCloseTo(1.875);
    expect(allocation.bucket).toBe("included");
  });

  it("hard-stops when included + purchased + gifted cannot cover the 0.75× debit", () => {
    expect(() =>
      allocateCreditDebit({
        included: 0.75,
        purchased: 0,
        gifted: 0,
        providerCostUsd: 1.01,
        serviceMultiplier: 0.75,
      }),
    ).toThrow(CreditCapExceededError);
  });

  it("is 25% cheaper than BYOK parity (1.0×) for the same list cost", () => {
    const listCost = 8;
    const hosted = allocateCreditDebit({
      included: 10,
      purchased: 0,
      gifted: 0,
      providerCostUsd: listCost,
      serviceMultiplier: DEFAULT_SERVICE_MULTIPLIER,
    });
    const byokParity = allocateCreditDebit({
      included: 10,
      purchased: 0,
      gifted: 0,
      providerCostUsd: listCost,
      serviceMultiplier: BYOK_LIST_MULTIPLIER,
    });
    expect(hosted.debit).toBeCloseTo(listCost * 0.75);
    expect(byokParity.debit).toBe(listCost);
    expect(hosted.debit / byokParity.debit).toBeCloseTo(0.75);
    expect(hosted.debit).not.toBeCloseTo(listCost * 1.25);
  });
});

describe("table-driven entitlement boundaries", () => {
  const free = {
    planCode: "free" as const,
    managedAllowanceUsd: 0,
    contextTokenLimit: 4000,
    agentStepLimit: 6,
    cadIterationLimit: 3,
    cadConcurrentJobs: 1,
    codeAnalysisMb: 5,
    jobPriority: 0,
    featureFlags: { advanced_strategy: false, core: true },
  };
  it("keeps feature entitlement separate from BYOK provider cost", () => {
    expect(
      evaluateEntitlement({
        entitlement: free,
        feature: "core",
        managedProviderCostUsedUsd: 0,
        estimatedManagedCostUsd: 99,
        keySource: "byo",
      }),
    ).toMatchObject({ allowed: true, bucket: "external_provider" });
    expect(
      evaluateEntitlement({
        entitlement: free,
        feature: "core",
        managedProviderCostUsedUsd: 0,
        estimatedManagedCostUsd: 99,
        keySource: "local_cli",
      }),
    ).toMatchObject({ allowed: true, bucket: "external_provider" });
    expect(
      evaluateEntitlement({
        entitlement: free,
        feature: "advanced_strategy",
        managedProviderCostUsedUsd: 0,
        estimatedManagedCostUsd: 0,
        keySource: "local",
      }),
    ).toMatchObject({ allowed: false, reason: "feature_not_in_plan" });
    expect(
      evaluateEntitlement({
        entitlement: free,
        feature: "advanced_strategy",
        managedProviderCostUsedUsd: 0,
        estimatedManagedCostUsd: 0,
        keySource: "local",
        releaseFeatureFlags: { advanced_strategy: true },
      }),
    ).toMatchObject({ allowed: true, bucket: "external_provider" });
  });
  it("stops managed usage at the snapshotted period allowance", () => {
    const pro = {
      ...free,
      planCode: "individual_pro" as const,
      managedAllowanceUsd: 27,
      featureFlags: { core: true, priority_features: true },
    };
    expect(
      evaluateEntitlement({
        entitlement: pro,
        feature: "core",
        managedProviderCostUsedUsd: 26.9,
        estimatedManagedCostUsd: 0.2,
        keySource: "platform",
      }),
    ).toMatchObject({ allowed: false, reason: "managed_allowance_exhausted" });
    expect(
      isPlanPeriodActive(
        { periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-08-01"), status: "active" },
        new Date("2026-07-15"),
      ),
    ).toBe(true);
    expect(
      isPlanPeriodActive(
        { periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-08-01"), status: "active" },
        new Date("2026-08-01"),
      ),
    ).toBe(false);
  });
});

describe("free sponsored AI guardrails", () => {
  const approved = {
    enabled: true,
    providerCommercialUseApproved: true,
    approvalSource: "provider-commercial-terms-v1",
    monthlyAllowanceUsd: 1,
    monthlyUsedUsd: 0,
    orgDailyRequests: 0,
    orgDailyLimit: 20,
    userDailyRequests: 0,
    userDailyLimit: 5,
    ipDailyRequests: 0,
    ipDailyLimit: 8,
    activeRequests: 0,
    concurrencyLimit: 1,
    estimatedCostUsd: 0.01,
    verifiedEmail: true,
    closedTeamMember: true,
  };
  it("defaults unavailable and always offers cost-safe alternatives", () => {
    expect(evaluateFreeManagedUsage({ ...approved, enabled: false })).toEqual({
      allowed: false,
      reason: "sponsored_ai_unavailable",
      offers: ["byok", "local", "upgrade"],
    });
  });
  it("requires commercial approval and explicit hard caps", () => {
    expect(evaluateFreeManagedUsage({ ...approved, providerCommercialUseApproved: false })).toMatchObject({
      allowed: false,
      reason: "commercial_approval_required",
    });
    expect(evaluateFreeManagedUsage({ ...approved, monthlyUsedUsd: 1 })).toMatchObject({
      allowed: false,
      reason: "sponsored_allowance_exhausted",
    });
    expect(evaluateFreeManagedUsage({ ...approved, activeRequests: 1 })).toMatchObject({
      allowed: false,
      reason: "low_priority_capacity_busy",
    });
  });
  it("allows only verified invited members at low priority", () => {
    expect(evaluateFreeManagedUsage(approved)).toMatchObject({
      allowed: true,
      bucket: "sponsored",
      priority: "low",
    });
    expect(evaluateFreeManagedUsage({ ...approved, verifiedEmail: false })).toMatchObject({
      allowed: false,
      reason: "verified_invited_member_required",
    });
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
          return { rowCount: 1, rows: [{ orgId: "org", planCode: "team_trial" }] };
        return { rowCount: 1, rows: [] };
      },
    } as unknown as PoolClient;
    const now = new Date("2026-07-15T12:00:00Z");
    expect(await expireTrials(client, now)).toBe(1);
    expect(calls[0]?.[1]).toEqual([now]);
  });
});
