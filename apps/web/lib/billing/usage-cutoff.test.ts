import { describe, expect, it } from "vitest";
import {
  buildUsageCutoffSnapshot,
  cutoffCheckoutVisible,
  cutoffCtas,
  evaluateUsageCutoff,
  isCutoffError,
  messageForCutoffError,
  resolveCutoffErrorCode,
} from "./usage-cutoff";

describe("evaluateUsageCutoff", () => {
  it("returns null when usage is comfortably under thresholds", () => {
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 130,
      usedUsd: 20,
      warningThresholds: [50, 75, 90],
    });
    expect(evaluateUsageCutoff(snap)).toBeNull();
  });

  it("raises nothing for old hosted-allowance, credit or pay-as-you-go numbers", () => {
    // Vantage is free and runs AI on the team's own key: none of these can stop a team.
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 40,
      usedUsd: 40,
      paygEnabled: false,
      walletBalanceUsd: 0,
    });
    expect(evaluateUsageCutoff(snap)).toBeNull();
  });

  it("stops at the team's own monthly limit and points at AI limits", () => {
    const snap = buildUsageCutoffSnapshot({ monthlySpendUsd: 25, monthlySpendLimitUsd: 25 });
    const alert = evaluateUsageCutoff(snap);
    expect(alert).toMatchObject({ level: "at", reason: "org_budget" });
    const ctas = cutoffCtas(alert!, "org-1");
    expect(ctas.map((c) => c.id)).toEqual(["budgets"]);
    expect(ctas[0]?.href).toContain("tab=budgets");
    expect(ctas[0]?.href).toContain("orgId=org-1");
    expect(ctas.some((c) => c.checkoutAction)).toBe(false);
  });

  it("surfaces kill switch above allowance math", () => {
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 100,
      usedUsd: 0,
      killSwitch: true,
    });
    expect(evaluateUsageCutoff(snap)?.reason).toBe("kill_switch");
  });

  it("warns on org monthly budget near the configured threshold", () => {
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 0,
      usedUsd: 0,
      monthlySpendUsd: 90,
      monthlySpendLimitUsd: 100,
      warningThresholds: [50, 75, 90],
    });
    const alert = evaluateUsageCutoff(snap);
    expect(alert?.level).toBe("near");
    expect(alert?.reason).toBe("org_budget");
  });
});

describe("cutoffCheckoutVisible", () => {
  it("keeps an explicit caller decision", () => {
    expect(cutoffCheckoutVisible(true, "scout")).toBe(true);
    expect(cutoffCheckoutVisible(false, "owner")).toBe(false);
  });

  it("hides checkout until the account is an owner or admin", () => {
    expect(cutoffCheckoutVisible(undefined, undefined)).toBe(false);
    expect(cutoffCheckoutVisible(undefined, "scout")).toBe(false);
    expect(cutoffCheckoutVisible(undefined, "viewer")).toBe(false);
    expect(cutoffCheckoutVisible(undefined, "owner")).toBe(true);
    expect(cutoffCheckoutVisible(undefined, "admin")).toBe(true);
  });
});

describe("cutoff error mapping", () => {
  it("sends every old allowance, credit or pay-as-you-go stop to the team's own key", () => {
    expect(isCutoffError("CreditCapExceededError")).toBe(true);
    expect(isCutoffError("payg_not_enabled")).toBe(true);
    for (const code of ["managed_allowance_exhausted", "payg_not_enabled", "credit_cap_exceeded", "sponsored_promo_expired", "usage_hard_cutoff"]) {
      const msg = messageForCutoffError(code, "org-9");
      expect(msg.title).toBe("AI needs your team's key");
      expect(msg.ctas[0]).toMatchObject({ id: "ai-keys", label: "Add your team's AI key" });
      expect(msg.ctas.some((c) => c.checkoutAction || c.id === "pricing" || c.id === "credits")).toBe(false);
    }
  });

  it("names the team's own limit and the pause switch plainly", () => {
    expect(messageForCutoffError("budget_limit_exceeded", "org-1").title).toMatch(/team's AI limit/);
    expect(messageForCutoffError("kill_switch", "org-1").title).toBe("AI is paused");
  });
});

describe("resolveCutoffErrorCode (chat / agent)", () => {
  it("maps 402 usage_hard_cutoff bodies the way agent failMeteredAi returns them", () => {
    expect(
      resolveCutoffErrorCode(402, {
        error: "Included allowance exhausted",
        code: "usage_hard_cutoff",
        reason: "payg_not_enabled",
        hardCutoff: true,
      }),
    ).toBe("usage_hard_cutoff");
  });

  it("prefers sponsored_promo_expired over generic usage_hard_cutoff", () => {
    expect(
      resolveCutoffErrorCode(402, {
        error: "Promotional sponsored AI ended",
        code: "usage_hard_cutoff",
        reason: "sponsored_promo_expired",
        hardCutoff: true,
      }),
    ).toBe("sponsored_promo_expired");
  });

  it("maps credit and budget cutoff codes without requiring status 402", () => {
    expect(resolveCutoffErrorCode(403, { code: "credit_cap_exceeded", error: "Credit limit" })).toBe(
      "credit_cap_exceeded",
    );
    expect(resolveCutoffErrorCode(402, { code: "budget_limit_exceeded", reason: "org.daily_spend" })).toBe(
      "budget_limit_exceeded",
    );
  });

  it("returns null for ordinary agent failures", () => {
    expect(resolveCutoffErrorCode(400, { error: "orgId is required" })).toBeNull();
    expect(resolveCutoffErrorCode(404, { error: "Thread not found" })).toBeNull();
  });

  it("falls back when status is 402 but body omits code", () => {
    expect(resolveCutoffErrorCode(402, { error: "hard stop" })).toBe("hard stop");
    expect(resolveCutoffErrorCode(402, {})).toBe("usage_hard_cutoff");
  });
});
