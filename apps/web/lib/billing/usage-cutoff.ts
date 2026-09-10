/** Soft-UI + CTA helpers for plan allowance / credit / PAYG hard cutoffs. */

import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type CutoffLevel = "ok" | "near" | "at";

export type CutoffReason =
  | "allowance"
  | "credits"
  | "spend_cap"
  | "org_budget"
  | "kill_switch"
  | "payg_required"
  | "sponsored_promo_expired";

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
  id: "credits" | "payg" | "upgrade" | "budgets" | "pricing" | "chat" | "account" | "ai-keys";
  label: string;
  /** Checkout action when Stripe is wired; otherwise UI falls back to /pricing. */
  checkoutAction?: "credits" | "payg" | "subscription";
  packCode?: string;
  planCode?: string;
  href?: string;
};

/** Soft-UI deep links for cut-off CTAs — hubHref / withOrgHref only. */
export function cutoffBudgetsHref(orgId?: string | null): string {
  return hubHref("/ai", "budgets", orgId);
}

export function cutoffPricingHref(orgId?: string | null): string {
  const base = withOrgHref("/pricing", orgId);
  return `${base}#credits`;
}

export function cutoffChatHref(orgId?: string | null): string {
  return hubHref("/ai", "chat", orgId);
}

export function cutoffAccountHref(orgId?: string | null): string {
  return withOrgHref("/account", orgId);
}

export function cutoffAiKeysHref(orgId?: string | null): string {
  return hubHref("/ai", "ai-keys", orgId);
}

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
  "sponsored_promo_expired",
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
      body: "An admin paused Chat. They can turn it back on under Chat limits.",
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
        title: "Hosted AI usage exhausted",
        body: "Hosted Chat for this period is used up. Buy credits, turn on pay-as-you-go with a spend cap, or upgrade.",
        percent: allowance,
      };
    }
    if (snapshot.walletBalanceUsd <= 0 && snapshot.paygEnabled) {
      return {
        level: "at",
        reason: "credits",
        title: "AI credits depleted",
        body: "Plan hosted usage is used up and prepaid credits are at $0. Buy another pack or raise the pay-as-you-go spend cap.",
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
        title: "Pay-as-you-go spend cap reached",
        body: "Spending stopped at the monthly cap. Raise the cap, buy credits, or wait for the next billing period.",
        percent: 100,
      };
    }
  }

  if (snapshot.orgMonthlyBudgetPercent != null && snapshot.orgMonthlyBudgetPercent >= 100) {
    return {
      level: "at",
      reason: "org_budget",
      title: "Org monthly API budget reached",
      body: "Team spend limits blocked further Chat. Raise the monthly limit under Chat limits, or wait until next month.",
      percent: snapshot.orgMonthlyBudgetPercent,
    };
  }

  const candidates: Array<{ percent: number | null; reason: CutoffReason; title: string; body: string }> = [];
  if (allowance != null && allowance >= floor) {
    candidates.push({
      percent: allowance,
      reason: "allowance",
      title: "Approaching hosted AI limit",
      body: `${Math.round(allowance)}% of this period’s hosted Chat is used. After 100%, Chat stops unless you buy credits or turn on pay-as-you-go.`,
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
      title: "AI credits running low",
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
  const budgetsHref = cutoffBudgetsHref(orgId);
  const pricingHref = cutoffPricingHref(orgId);
  const aiKeysHref = cutoffAiKeysHref(orgId);
  const ctas: CutoffCta[] = [];

  if (alert.reason === "sponsored_promo_expired") {
    ctas.push({ id: "ai-keys", label: "Add AI keys", href: aiKeysHref });
    ctas.push({ id: "pricing", label: "Upgrade for hosted AI", href: pricingHref });
    return ctas;
  }

  if (alert.reason === "kill_switch" || alert.reason === "org_budget") {
    ctas.push({ id: "budgets", label: "Open Chat limits", href: budgetsHref });
  }

  if (alert.reason === "allowance" || alert.reason === "payg_required" || alert.reason === "credits") {
    ctas.push({
      id: "credits",
      label: "Buy AI credits",
      checkoutAction: "credits",
      packCode: "credits_100",
      href: pricingHref,
    });
    ctas.push({
      id: "payg",
      label: "Turn on pay-as-you-go",
      checkoutAction: "payg",
      href: pricingHref,
    });
  }

  if (alert.reason === "spend_cap") {
    ctas.push({
      id: "credits",
      label: "Buy AI credits",
      checkoutAction: "credits",
      packCode: "credits_100",
      href: pricingHref,
    });
    ctas.push({ id: "pricing", label: "Review pricing", href: pricingHref });
  }

  if (alert.reason === "allowance" || alert.reason === "payg_required") {
    ctas.push({
      id: "upgrade",
      label: "Upgrade plan",
      checkoutAction: "subscription",
      planCode: "pro",
      href: pricingHref,
    });
  }

  if (!ctas.some((c) => c.id === "budgets")) {
    ctas.push({ id: "budgets", label: "Chat limits", href: budgetsHref });
  }

  if (!ctas.some((c) => c.id === "pricing")) {
    ctas.push({ id: "pricing", label: "Pricing", href: pricingHref });
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
  const budgetsHref = cutoffBudgetsHref(org || null);
  const pricingHref = cutoffPricingHref(org || null);

  const match = (needle: string) => lower.includes(needle);

  let reason: CutoffReason = "allowance";
  let title = "Chat paused";
  let body =
    "This team hit a usage limit. Buy credits, turn on pay-as-you-go with a spend cap, or upgrade.";

  if (match("sponsored_promo_expired") || match("promotional sponsored ai")) {
    reason = "sponsored_promo_expired";
    title = "Sponsored AI ended";
    body =
      "Promotional sponsored AI for team 1111 ended on 2026-10-18. Add your own AI keys or upgrade for hosted AI — the rest of the workspace keeps working.";
  } else if (match("kill_switch") || match("billingdisabled") || match("billing_disabled")) {
    reason = "kill_switch";
    title = "AI routing paused";
    body = "An admin paused Chat. They can turn it back on under Chat limits.";
  } else if (match("spend_cap") || match("overage spend")) {
    reason = "spend_cap";
    title = "Pay-as-you-go spend cap reached";
    body = "Spending stopped at the monthly pay-as-you-go cap.";
  } else if (match("insufficient_prepaid") || match("credit_cap") || match("credit limit") || match("usage_hard_cutoff")) {
    reason = match("payg_not_enabled") ? "payg_required" : "credits";
    title = match("payg_not_enabled") ? "Pay-as-you-go or credits required" : "Chat credits used up";
    body = match("payg_not_enabled")
      ? "Hosted Chat is used up and pay-as-you-go is off. Turn it on or buy credits to continue."
      : "Prepaid credits cannot cover this call. Buy a pack or turn on pay-as-you-go.";
  } else if (match("payg_not_enabled")) {
    reason = "payg_required";
    title = "Pay-as-you-go or credits required";
    body = "Hosted Chat is used up and pay-as-you-go is off. Turn it on or buy credits to continue.";
  } else if (match("managed_allowance") || match("sponsored_allowance") || match("allowance")) {
    reason = "allowance";
    title = "Hosted AI usage exhausted";
    body = "Hosted Chat for this period is used up. Buy credits or upgrade.";
  } else if (match("budget") || match("daily_spend") || match("monthly_spend") || match("daily_tokens") || match("monthly_tokens")) {
    reason = "org_budget";
    title = "Team spend limit reached";
    body = "A team spend limit blocked this call. Adjust limits under Chat limits.";
  }

  const alert: UsageCutoffAlert = { level: "at", reason, title, body, percent: null };
  const ctas = org
    ? cutoffCtas(alert, org)
    : reason === "sponsored_promo_expired"
      ? [
          { id: "ai-keys" as const, label: "Add AI keys", href: cutoffAiKeysHref(null) },
          { id: "pricing" as const, label: "Upgrade for hosted AI", href: pricingHref },
        ]
      : [
          { id: "pricing" as const, label: "View pricing", href: pricingHref },
          { id: "budgets" as const, label: "Chat limits", href: budgetsHref },
          { id: "chat" as const, label: "Chat", href: cutoffChatHref(null) },
          { id: "account" as const, label: "Account", href: cutoffAccountHref(null) },
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
export function resolveCutoffErrorCode(status: number, body?: unknown): string | null {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const code = record?.code != null ? String(record.code) : "";
  const reason = record?.reason != null ? String(record.reason) : "";
  const error = record?.error != null ? String(record.error) : "";
  const hardCutoff = record?.hardCutoff === true;
  if (status === 402 || hardCutoff || isCutoffError(code) || isCutoffError(reason) || isCutoffError(error)) {
    // Prefer specific promo-expiry reason so Soft-UI shows BYOK CTAs, not generic credit copy.
    if (/sponsored_promo_expired/i.test(reason) || /sponsored_promo_expired/i.test(error)) {
      return "sponsored_promo_expired";
    }
    return code || reason || error || "usage_hard_cutoff";
  }
  return null;
}
