import { describe, expect, it } from "vitest";
import {
  buildUsageCutoffSnapshot,
  cutoffCtas,
  evaluateUsageCutoff,
  isCutoffError,
  messageForCutoffError,
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
    expect(msg.title.toLowerCase()).toContain("allowance");
    expect(msg.ctas.some((c) => c.checkoutAction === "credits" || c.id === "credits")).toBe(true);
  });
});
