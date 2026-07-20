import { describe, expect, it } from "vitest";
import {
  buildUsageCutoffSnapshot,
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

  it("warns when approaching included allowance", () => {
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 100,
      usedUsd: 80,
      warningThresholds: [50, 75, 90],
    });
    const alert = evaluateUsageCutoff(snap);
    expect(alert?.level).toBe("near");
    expect(alert?.reason).toBe("allowance");
    expect(alert?.percent).toBeCloseTo(80);
  });

  it("hard-stops at 100% allowance without PAYG or credits", () => {
    const snap = buildUsageCutoffSnapshot({
      includedAllowanceUsd: 40,
      usedUsd: 40,
      paygEnabled: false,
      walletBalanceUsd: 0,
    });
    const alert = evaluateUsageCutoff(snap);
    expect(alert?.level).toBe("at");
    expect(alert?.reason).toBe("allowance");
    const ctas = cutoffCtas(alert!, "org-1");
    expect(ctas.some((c) => c.id === "credits")).toBe(true);
    expect(ctas.some((c) => c.id === "payg")).toBe(true);
    expect(ctas.some((c) => c.id === "upgrade")).toBe(true);
    expect(ctas.find((c) => c.id === "budgets")?.href).toContain("/ai?");
    expect(ctas.find((c) => c.id === "budgets")?.href).toContain("tab=budgets");
    expect(ctas.find((c) => c.id === "budgets")?.href).toContain("orgId=org-1");
    expect(ctas.find((c) => c.id === "budgets")?.href).not.toMatch(/\/team\/budgets\?/);
    expect(ctas.find((c) => c.id === "pricing")?.href).toContain("/pricing");
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

describe("cutoff Soft-UI error mapping", () => {
  it("maps credit / PAYG codes to actionable copy", () => {
    expect(isCutoffError("CreditCapExceededError")).toBe(true);
    expect(isCutoffError("payg_not_enabled")).toBe(true);
    const msg = messageForCutoffError("managed_allowance_exhausted", "org-9");
    expect(msg.title.toLowerCase()).toMatch(/hosted ai|allowance|exhausted/);
    expect(msg.ctas.some((c) => c.checkoutAction === "credits" || c.id === "credits")).toBe(true);
  });

  it("maps sponsored_promo_expired to BYOK / upgrade CTAs (AI-only)", () => {
    const msg = messageForCutoffError("sponsored_promo_expired", "org-1111");
    expect(msg.title).toMatch(/Sponsored AI ended/i);
    expect(msg.body).toMatch(/keeps working/i);
    expect(msg.ctas.some((c) => c.id === "ai-keys")).toBe(true);
    expect(msg.ctas.some((c) => c.id === "pricing")).toBe(true);
    expect(msg.ctas.some((c) => c.checkoutAction === "credits")).toBe(false);
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
