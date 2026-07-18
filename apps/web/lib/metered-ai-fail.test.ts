import { describe, expect, it } from "vitest";
import {
  BudgetLimitExceededError,
  CreditCapExceededError,
  UsageHardCutoffError,
  classifyMeteredAiError,
  meteredAiErrorBody,
} from "@vantage/billing";
import { failMeteredAi } from "./metered-ai-fail";

describe("failMeteredAi hard cutoffs", () => {
  it("maps UsageHardCutoffError to 402 with CTA", async () => {
    const response = failMeteredAi(new UsageHardCutoffError("payg_not_enabled"), "fallback");
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toMatchObject({
      hardCutoff: true,
      code: "usage_hard_cutoff",
      reason: "payg_not_enabled",
      cta: { href: "/team/usage" },
    });
    expect(body.error).toMatch(/exhausted/i);
  });

  it("maps CreditCapExceededError to 402", async () => {
    const response = failMeteredAi(new CreditCapExceededError(), "fallback");
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.code).toBe("credit_cap_exceeded");
    expect(body.hardCutoff).toBe(true);
  });

  it("maps BudgetLimitExceededError to 402 with budgets CTA", async () => {
    const response = failMeteredAi(new BudgetLimitExceededError("org.daily_spend"), "fallback");
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "budget_limit_exceeded",
      reason: "org.daily_spend",
      cta: { href: "/team/budgets" },
    });
  });

  it("leaves non-cutoff errors on the fallback status", async () => {
    const response = failMeteredAi(new Error("orgId is required"), "failed");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("orgId is required");
    expect(body.hardCutoff).toBeUndefined();
  });
});

describe("classifyMeteredAiError", () => {
  it("classifies spend_cap and prepaid reasons", () => {
    expect(classifyMeteredAiError(new UsageHardCutoffError("spend_cap"))).toMatchObject({
      status: 402,
      reason: "spend_cap",
    });
    expect(meteredAiErrorBody(classifyMeteredAiError(new UsageHardCutoffError("insufficient_prepaid_balance"))!)).toMatchObject({
      hardCutoff: true,
      reason: "insufficient_prepaid_balance",
    });
  });
});
