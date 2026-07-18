/** Soft-UI + CTA helpers for plan allowance / credit / PAYG hard cutoffs. */

export type CutoffLevel = "ok" | "near" | "at";

export type CutoffReason =
  | "allowance"
  | "credits"
  | "spend_cap"
  | "org_budget"
  | "kill_switch"
  | "payg_required";

export type UsageCutoffSnapshot = {
  planCode: string | null;
  includedAllowanceUsd: number;
  usedUsd: number;
  allowancePercent: number | null;
  walletBalanceUsd: number;
  paygEnabled: boolean;
  spendCapUsd: number | null;
  killSwitch: boolean;
  /** Org API budget monthly spend vs monthly limit (0–100+), when a limit is set. */
  orgMonthlyBudgetPercent: number | null;
  warningThresholds: number[];
};

export type UsageCutoffAlert = {
  level: CutoffLevel;
  reason: CutoffReason;
  title: string;
  body: string;
  percent: number | null;
};

export type CutoffCta = {
  id: "credits" | "payg" | "upgrade" | "budgets" | "pricing";
  label: string;
  /** Checkout action when Stripe is wired; otherwise UI falls back to /pricing. */
  checkoutAction?: "credits" | "payg" | "subscription";
  packCode?: string;
  planCode?: string;
  href?: string;
};

/** Machine codes returned by meteredAI / evaluateManagedUsage / budget denials. */
export const CUTOFF_ERROR_CODES = [
  "usage_hard_cutoff",
  "credit_cap_exceeded",
  "managed_allowance_exhausted",
  "payg_not_enabled",
  "insufficient_prepaid_balance",
  "spend_cap",
  "kill_switch",
  "org.kill_switch",
  "sponsored_allowance_exhausted",
  "budget_limit_exceeded",
  "billing_disabled",
] as const;

export type CutoffErrorCode = (typeof CUTOFF_ERROR_CODES)[number] | string;

const DEFAULT_NEAR = 75;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nearFloor(thresholds: number[]): number {
  const sorted = thresholds.filter((t) => Number.isFinite(t) && t > 0 && t < 100).sort((a, b) => a - b);
  if (!sorted.length) return DEFAULT_NEAR;
  // Prefer the classic approaching band (≤75); else the earliest custom threshold.
  const approaching = sorted.filter((t) => t <= DEFAULT_NEAR);
  if (approaching.length) return approaching[approaching.length - 1]!;
  return sorted[0]!;
}

export function allowancePercent(usedUsd: number, includedUsd: number): number | null {
  if (!(includedUsd > 0)) return null;
  return Math.max(0, (usedUsd / includedUsd) * 100);
}

export function buildUsageCutoffSnapshot(input: {
  planCode?: string | null;
  includedAllowanceUsd?: number | string | null;
  usedUsd?: number | string | null;
  walletBalanceUsd?: number | string | null;
  paygEnabled?: boolean | null;
  spendCapUsd?: number | string | null;
  killSwitch?: boolean | null;
  monthlySpendUsd?: number | string | null;
  monthlySpendLimitUsd?: number | string | null;
  warningThresholds?: number[] | null;
}): UsageCutoffSnapshot {
  const included = num(input.includedAllowanceUsd);
  const used = num(input.usedUsd);
  const monthlyLimit = num(input.monthlySpendLimitUsd);
  const monthlySpend = num(input.monthlySpendUsd);
  return {
    planCode: input.planCode ?? null,
    includedAllowanceUsd: included,
    usedUsd: used,
    allowancePercent: allowancePercent(used, included),
    walletBalanceUsd: num(input.walletBalanceUsd),
    paygEnabled: Boolean(input.paygEnabled),
    spendCapUsd: input.spendCapUsd == null || input.spendCapUsd === "" ? null : num(input.spendCapUsd),
    killSwitch: Boolean(input.killSwitch),
    orgMonthlyBudgetPercent:
      monthlyLimit > 0 ? Math.max(0, (monthlySpend / monthlyLimit) * 100) : null,
    warningThresholds: (input.warningThresholds ?? [50, 75, 90]).map(Number).filter(Number.isFinite),
  };
}

export function evaluateUsageCutoff(snapshot: UsageCutoffSnapshot): UsageCutoffAlert | null {
  if (snapshot.killSwitch) {
    return {
      level: "at",
      reason: "kill_switch",
      title: "AI routing paused",
      body: "The organization kill switch is on. Managed AI calls hard-stop until an admin turns it off on API budgets.",
      percent: null,
    };
  }

  const floor = nearFloor(snapshot.warningThresholds);
  const allowance = snapshot.allowancePercent;

  if (allowance != null && allowance >= 100) {
    if (!snapshot.paygEnabled && snapshot.walletBalanceUsd <= 0) {
      return {
        level: "at",
        reason: "allowance",
        title: "Included API allowance exhausted",
        body: "Managed AI hard-stopped at the included allowance. Buy Usage Credits, enable PAYG with a spend cap, or upgrade — there is no silent overage.",
        percent: allowance,
      };
    }
    if (snapshot.walletBalanceUsd <= 0 && snapshot.paygEnabled) {
      return {
        level: "at",
        reason: "credits",
        title: "Usage Credits depleted",
        body: "Included allowance is gone and prepaid Usage Credits are at $0. Buy another credit pack or raise the PAYG spend cap to resume managed calls.",
        percent: allowance,
      };
    }
  }

  if (snapshot.paygEnabled && snapshot.spendCapUsd != null && snapshot.spendCapUsd > 0) {
    // When allowance is exhausted, spend cap is the remaining hard stop for overage.
    if (allowance != null && allowance >= 100 && snapshot.walletBalanceUsd <= 0) {
      return {
        level: "at",
        reason: "spend_cap",
        title: "PAYG spend cap reached",
        body: "Overage is hard-stopped at the monthly PAYG spend cap. Raise the cap, buy Usage Credits, or wait for the next billing period.",
        percent: 100,
      };
    }
  }

  if (snapshot.orgMonthlyBudgetPercent != null && snapshot.orgMonthlyBudgetPercent >= 100) {
    return {
      level: "at",
      reason: "org_budget",
      title: "Org monthly API budget reached",
      body: "Team hard limits blocked further metered calls. Raise the monthly spend limit on API budgets, or wait until the next month.",
      percent: snapshot.orgMonthlyBudgetPercent,
    };
  }

  const candidates: Array<{ percent: number | null; reason: CutoffReason; title: string; body: string }> = [];
  if (allowance != null && allowance >= floor) {
    candidates.push({
      percent: allowance,
      reason: "allowance",
      title: "Approaching included API allowance",
      body: `${Math.round(allowance)}% of this period’s included allowance is used. After 100%, managed AI hard-stops unless you buy Usage Credits or enable PAYG.`,
    });
  }
  if (snapshot.orgMonthlyBudgetPercent != null && snapshot.orgMonthlyBudgetPercent >= floor) {
    candidates.push({
      percent: snapshot.orgMonthlyBudgetPercent,
      reason: "org_budget",
      title: "Approaching org API budget",
      body: `${Math.round(snapshot.orgMonthlyBudgetPercent)}% of the org monthly spend limit is used. Metered calls will hard-stop at the limit.`,
    });
  }
  if (snapshot.walletBalanceUsd > 0 && snapshot.walletBalanceUsd < 5 && (allowance == null || allowance >= 90)) {
    candidates.push({
      percent: null,
      reason: "credits",
      title: "Usage Credits running low",
      body: `About $${snapshot.walletBalanceUsd.toFixed(2)} prepaid credits remain. Buy another pack before managed calls hard-stop.`,
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const top = candidates[0]!;
  return {
    level: "near",
    reason: top.reason,
    title: top.title,
    body: top.body,
    percent: top.percent,
  };
}

export function cutoffCtas(alert: UsageCutoffAlert, orgId: string): CutoffCta[] {
  const q = `?orgId=${encodeURIComponent(orgId)}`;
  const ctas: CutoffCta[] = [];

  if (alert.reason === "kill_switch" || alert.reason === "org_budget") {
    ctas.push({ id: "budgets", label: "Open API budgets", href: `/team/budgets${q}` });
  }

  if (alert.reason === "allowance" || alert.reason === "payg_required" || alert.reason === "credits") {
    ctas.push({
      id: "credits",
      label: "Buy Usage Credits",
      checkoutAction: "credits",
      packCode: "credits_100",
      href: "/pricing",
    });
    ctas.push({
      id: "payg",
      label: "Enable PAYG",
      checkoutAction: "payg",
      href: "/pricing",
    });
  }

  if (alert.reason === "spend_cap") {
    ctas.push({
      id: "credits",
      label: "Buy Usage Credits",
      checkoutAction: "credits",
      packCode: "credits_100",
      href: "/pricing",
    });
    ctas.push({ id: "pricing", label: "Review pricing", href: "/pricing" });
  }

  if (alert.reason === "allowance" || alert.reason === "payg_required") {
    ctas.push({
      id: "upgrade",
      label: "Upgrade plan",
      checkoutAction: "subscription",
      planCode: "team_pro",
      href: "/pricing",
    });
  }

  if (!ctas.some((c) => c.id === "budgets")) {
    ctas.push({ id: "budgets", label: "API budgets", href: `/team/budgets${q}` });
  }

  return ctas;
}

/** Map API / meteredAI error names or reason codes to Soft-UI copy. */
export function messageForCutoffError(
  codeOrMessage: CutoffErrorCode,
  orgId?: string,
): { title: string; body: string; ctas: CutoffCta[] } {
  const raw = String(codeOrMessage ?? "");
  const lower = raw.toLowerCase();
  const org = orgId ?? "";
  const budgetsHref = org ? `/team/budgets?orgId=${encodeURIComponent(org)}` : "/team/budgets";

  const match = (needle: string) => lower.includes(needle);

  let reason: CutoffReason = "allowance";
  let title = "Managed AI hard-stopped";
  let body =
    "This workspace hit a usage hard cut-off. Buy Usage Credits, enable PAYG with a spend cap, or upgrade — Vantage does not silently overage.";

  if (match("kill_switch") || match("billingdisabled") || match("billing_disabled")) {
    reason = "kill_switch";
    title = "AI routing paused";
    body = "The organization kill switch blocked this call. An admin can clear it on API budgets.";
  } else if (match("spend_cap") || match("overage spend")) {
    reason = "spend_cap";
    title = "PAYG spend cap reached";
    body = "Overage is hard-stopped at the monthly PAYG spend cap.";
  } else if (match("insufficient_prepaid") || match("credit_cap") || match("credit limit") || match("usage_hard_cutoff")) {
    reason = match("payg_not_enabled") ? "payg_required" : "credits";
    title = match("payg_not_enabled") ? "PAYG or credits required" : "Usage Credits exhausted";
    body = match("payg_not_enabled")
      ? "Included allowance is exhausted and PAYG is off. Enable PAYG or buy Usage Credits to continue."
      : "Prepaid Usage Credits cannot cover this call. Buy a credit pack or enable PAYG.";
  } else if (match("payg_not_enabled")) {
    reason = "payg_required";
    title = "PAYG or credits required";
    body = "Included allowance is exhausted and PAYG is off. Enable PAYG or buy Usage Credits to continue.";
  } else if (match("managed_allowance") || match("sponsored_allowance") || match("allowance")) {
    reason = "allowance";
    title = "Included allowance exhausted";
    body = "Managed AI hard-stopped at the included allowance. No silent overage.";
  } else if (match("budget") || match("daily_spend") || match("monthly_spend") || match("daily_tokens") || match("monthly_tokens")) {
    reason = "org_budget";
    title = "Org API budget limit reached";
    body = "A team hard limit blocked this call. Adjust limits on API budgets.";
  }

  const alert: UsageCutoffAlert = { level: "at", reason, title, body, percent: null };
  const ctas = org
    ? cutoffCtas(alert, org)
    : [
        { id: "pricing" as const, label: "View pricing", href: "/pricing" },
        { id: "budgets" as const, label: "API budgets", href: budgetsHref },
      ];

  return { title, body, ctas };
}

export function isCutoffError(codeOrMessage: unknown): boolean {
  if (codeOrMessage == null) return false;
  const s = String(codeOrMessage).toLowerCase();
  return (
    CUTOFF_ERROR_CODES.some((c) => s.includes(c.replace(/_/g, " ")) || s.includes(c)) ||
    s.includes("credit limit") ||
    s.includes("budget limit") ||
    s.includes("hard-stop") ||
    s.includes("hard stop") ||
    s.includes("creditcapexceeded") ||
    s.includes("budgetlimitexceeded")
  );
}

/** Extract a Soft-UI banner code from a metered AI / agent JSON error body. */
export function resolveCutoffErrorCode(
  status: number,
  body: {
    code?: unknown;
    reason?: unknown;
    error?: unknown;
    hardCutoff?: unknown;
  } | null | undefined,
): string | null {
  const code = body?.code != null ? String(body.code) : "";
  const reason = body?.reason != null ? String(body.reason) : "";
  const error = body?.error != null ? String(body.error) : "";
  const hardCutoff = body?.hardCutoff === true;
  if (status === 402 || hardCutoff || isCutoffError(code) || isCutoffError(reason) || isCutoffError(error)) {
    return code || reason || error || "usage_hard_cutoff";
  }
  return null;
}
