/** Plain copy and next steps for when AI stops: the team's own limits, the pause switch, or no key. */

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

/**
 * Vantage is free and AI runs on the team's own key, so the only limits a team meets are the
 * ones it set itself (a monthly spend limit) and the pause switch. Hosted allowance, credits and
 * pay-as-you-go no longer exist; old snapshots that still carry them raise no alert.
 */
export function evaluateUsageCutoff(snapshot: UsageCutoffSnapshot): UsageCutoffAlert | null {
  if (snapshot.killSwitch) {
    return {
      level: "at",
      reason: "kill_switch",
      title: "AI is paused",
      body: "An owner or mentor paused AI for the team. They can turn it back on under AI limits.",
      percent: null,
    };
  }

  const floor = nearFloor(snapshot.warningThresholds);
  const budget = snapshot.orgMonthlyBudgetPercent;
  if (budget != null && budget >= 100) {
    return {
      level: "at",
      reason: "org_budget",
      title: "Your team's monthly AI limit is reached",
      body: "AI stops until next month, or until an owner or mentor raises the limit under AI limits.",
      percent: budget,
    };
  }
  if (budget != null && budget >= floor) {
    return {
      level: "near",
      reason: "org_budget",
      title: "Close to your team's monthly AI limit",
      body: `${Math.round(budget)}% of this month's AI limit is used. AI stops at the limit.`,
      percent: budget,
    };
  }
  return null;
}

/**
 * Checkout stays with owners and admins unless the caller already decided.
 * An omitted flag with an unknown role stays closed.
 */
export function cutoffCheckoutVisible(canCheckout: boolean | undefined, role?: string | null): boolean {
  if (typeof canCheckout === "boolean") return canCheckout;
  const normalized = (role ?? "").toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

/** What to do about a stop: add the team's key, or look at the team's own limits. */
export function cutoffCtas(alert: UsageCutoffAlert, orgId: string): CutoffCta[] {
  const budgetsHref = cutoffBudgetsHref(orgId);
  const aiKeysHref = cutoffAiKeysHref(orgId);
  if (alert.reason === "kill_switch" || alert.reason === "org_budget" || alert.reason === "spend_cap") {
    return [{ id: "budgets", label: "Open AI limits", href: budgetsHref }];
  }
  return [
    { id: "ai-keys", label: "Add your team's AI key", href: aiKeysHref },
    { id: "budgets", label: "AI limits", href: budgetsHref },
  ];
}

const NEEDS_KEY = {
  title: "AI needs your team's key",
  body: "Vantage doesn't pay for AI: it runs on your team's own key. Add one (Google Gemini has a free key) and this works again.",
};

/** Map API / meteredAI error names or reason codes to plain copy. */
export function messageForCutoffError(
  codeOrMessage: CutoffErrorCode,
  orgId?: string,
): { title: string; body: string; ctas: CutoffCta[] } {
  const lower = String(codeOrMessage ?? "").toLowerCase();
  const match = (needle: string) => lower.includes(needle);

  let reason: CutoffReason = "allowance";
  let { title, body } = NEEDS_KEY;

  if (match("kill_switch") || match("billingdisabled") || match("billing_disabled")) {
    reason = "kill_switch";
    title = "AI is paused";
    body = "An owner or mentor paused AI for the team. They can turn it back on under AI limits.";
  } else if (
    !match("allowance") &&
    !match("payg") &&
    !match("credit") &&
    !match("prepaid") &&
    !match("sponsored") &&
    (match("budget") || match("daily_spend") || match("monthly_spend") || match("daily_tokens") || match("monthly_tokens"))
  ) {
    reason = "org_budget";
    title = "Your team's AI limit is reached";
    body = "A limit your team set stopped this. An owner or mentor can change it under AI limits.";
  }

  const alert: UsageCutoffAlert = { level: "at", reason, title, body, percent: null };
  return { title, body, ctas: cutoffCtas(alert, orgId ?? "") };
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
