/**
 * Hard usage cutoffs — shared error types + HTTP mapping for every metered AI path.
 * Included allowance exhausted → hard stop unless PAYG/credits are explicitly enabled.
 */

export type UsageCutoffReason =
  | "kill_switch"
  | "payg_not_enabled"
  | "insufficient_prepaid_balance"
  | "spend_cap"
  | "credit_cap"
  | "managed_allowance_exhausted"
  | "sponsored_allowance_exhausted"
  | "sponsored_promo_expired"
  | "budget_limit"
  | "billing_disabled"
  | "policy_denied"
  | "approval_required"
  | "free_tokens_exhausted";

export type UsageCutoffCode =
  | "usage_hard_cutoff"
  | "credit_cap_exceeded"
  | "budget_limit_exceeded"
  | "billing_disabled"
  | "ai_policy_denied"
  | "approval_required";

export type UsageCutoffCta = {
  href: string;
  label: string;
};

export type ClassifiedMeteredAiError = {
  status: 402 | 403 | 429;
  code: UsageCutoffCode;
  reason: UsageCutoffReason | string;
  message: string;
  cta: UsageCutoffCta;
};

const CTA_BILLING: UsageCutoffCta = {
  href: "/team/usage",
  label: "Buy credits or enable PAYG",
};
const CTA_UPGRADE: UsageCutoffCta = {
  href: "/pricing",
  label: "Upgrade plan",
};
const CTA_POLICY: UsageCutoffCta = {
  href: "/team/ai-policy",
  label: "Review AI policy",
};
const CTA_BUDGETS: UsageCutoffCta = {
  href: "/team/budgets",
  label: "Review API budgets",
};
const CTA_AI_KEYS: UsageCutoffCta = {
  href: "/team/ai-keys",
  label: "Add AI API keys",
};

/** Thrown when managed allowance / PAYG gate refuses a platform-billed call. */
export class UsageHardCutoffError extends Error {
  readonly code: UsageCutoffCode = "usage_hard_cutoff";

  constructor(readonly reason: UsageCutoffReason | string) {
    super(cutoffMessage(reason));
    this.name = "UsageHardCutoffError";
  }
}

export function cutoffMessage(reason: string): string {
  switch (reason) {
    case "kill_switch":
    case "billing_disabled":
      return "AI usage is currently disabled for this organization.";
    case "payg_not_enabled":
      return "Hosted AI usage is exhausted. Buy AI credits or enable pay-as-you-go to continue.";
    case "insufficient_prepaid_balance":
      return "Prepaid AI credits are insufficient for this request.";
    case "spend_cap":
      return "Pay-as-you-go spend cap has been reached for this organization.";
    case "credit_cap":
    case "managed_allowance_exhausted":
      return "This organization has reached its Vantage AI credit limit.";
    case "sponsored_allowance_exhausted":
      return "Sponsored AI is exhausted for this period.";
    case "sponsored_promo_expired":
      return "Promotional sponsored AI for team 1111 has ended (2026-10-18). Add your own AI keys under Team → AI API keys, or upgrade for hosted AI. The rest of the workspace keeps working.";
    case "budget_limit":
      return "An API budget limit was reached for this organization.";
    case "policy_denied":
      return "AI policy denied this request.";
    case "approval_required":
      return "This AI run requires administrator approval.";
    case "free_tokens_exhausted":
      return "This team is out of free tokens. Ask a platform admin to gift more, or add your own API key.";
    default:
      if (reason.includes("daily_") || reason.includes("monthly_")) {
        return `API budget limit reached (${reason}).`;
      }
      return `AI usage hard cutoff (${reason}).`;
  }
}

function ctaFor(reason: string): UsageCutoffCta {
  if (reason === "policy_denied" || reason === "approval_required") return CTA_POLICY;
  if (reason.includes("daily_") || reason.includes("monthly_") || reason === "budget_limit") {
    return CTA_BUDGETS;
  }
  if (reason === "sponsored_promo_expired" || reason === "free_tokens_exhausted") return CTA_AI_KEYS;
  if (reason === "managed_allowance_exhausted" || reason === "sponsored_allowance_exhausted") {
    return CTA_UPGRADE;
  }
  return CTA_BILLING;
}

/**
 * Map metering / governance errors to a stable API shape for Soft-UI banners.
 * Returns null when the error is not a usage cutoff (caller should use its own status).
 */
export function classifyMeteredAiError(error: unknown): ClassifiedMeteredAiError | null {
  if (!error || typeof error !== "object") return null;
  // withRls unwraps CommitAndThrowError for callers; unit tests may still see the wrapper.
  const unwrapped =
    "publicError" in error && error.publicError && typeof error.publicError === "object"
      ? error.publicError
      : error;
  const name = "name" in unwrapped && typeof unwrapped.name === "string" ? unwrapped.name : "";
  const message = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);

  if (name === "UsageHardCutoffError" || unwrapped instanceof UsageHardCutoffError) {
    const reason =
      "reason" in unwrapped && typeof (unwrapped as { reason: unknown }).reason === "string"
        ? (unwrapped as { reason: string }).reason
        : "payg_not_enabled";
    return {
      status: 402,
      code: "usage_hard_cutoff",
      reason,
      message: cutoffMessage(reason),
      cta: ctaFor(reason),
    };
  }

  if (name === "CreditCapExceededError" || /credit limit|cap exceeded/i.test(message)) {
    return {
      status: 402,
      code: "credit_cap_exceeded",
      reason: "credit_cap",
      message: cutoffMessage("credit_cap"),
      cta: CTA_BILLING,
    };
  }

  if (name === "BudgetLimitExceededError" || /API budget limit reached/i.test(message)) {
    const reason =
      "reason" in unwrapped && typeof (unwrapped as { reason: unknown }).reason === "string"
        ? (unwrapped as { reason: string }).reason
        : "budget_limit";
    return {
      status: 402,
      code: "budget_limit_exceeded",
      reason,
      message: cutoffMessage(reason),
      cta: CTA_BUDGETS,
    };
  }

  if (name === "BillingDisabledError" || /AI usage is currently disabled/i.test(message)) {
    return {
      status: 403,
      code: "billing_disabled",
      reason: "billing_disabled",
      message: cutoffMessage("billing_disabled"),
      cta: CTA_BILLING,
    };
  }

  if (name === "AiPolicyDeniedError" || /AI policy denied/i.test(message)) {
    return {
      status: 403,
      code: "ai_policy_denied",
      reason: "policy_denied",
      message: message || cutoffMessage("policy_denied"),
      cta: CTA_POLICY,
    };
  }

  if (name === "FreeTokensExhaustedError" || /out of free tokens/i.test(message)) {
    return {
      status: 402,
      code: "usage_hard_cutoff",
      reason: "free_tokens_exhausted",
      message: message || cutoffMessage("free_tokens_exhausted"),
      cta: CTA_AI_KEYS,
    };
  }

  if (name === "ApprovalRequiredError" || /requires administrator approval/i.test(message)) {
    return {
      status: 403,
      code: "approval_required",
      reason: "approval_required",
      message: message || cutoffMessage("approval_required"),
      cta: CTA_POLICY,
    };
  }

  if (
    /payg_not_enabled|insufficient_prepaid_balance|spend_cap|managed_allowance_exhausted|sponsored_allowance_exhausted|sponsored_promo_expired/i.test(
      message,
    )
  ) {
    const reason = message.match(
      /payg_not_enabled|insufficient_prepaid_balance|spend_cap|managed_allowance_exhausted|sponsored_allowance_exhausted|sponsored_promo_expired/i,
    )?.[0]?.toLowerCase() ?? "payg_not_enabled";
    return {
      status: 402,
      code: "usage_hard_cutoff",
      reason,
      message: cutoffMessage(reason),
      cta: ctaFor(reason),
    };
  }

  return null;
}

/** JSON body shared by every metered route on hard cutoff. */
export function meteredAiErrorBody(
  classified: ClassifiedMeteredAiError,
): {
  error: string;
  code: UsageCutoffCode;
  reason: string;
  cta: UsageCutoffCta;
  hardCutoff: true;
} {
  return {
    error: classified.message,
    code: classified.code,
    reason: classified.reason,
    cta: classified.cta,
    hardCutoff: true,
  };
}

/**
 * Build a Response for a caught metered-AI failure.
 * When the error is not a cutoff, returns null so the route can apply its own fallback.
 */
export function meteredAiErrorResponse(
  error: unknown,
): Response | null {
  const classified = classifyMeteredAiError(error);
  if (!classified) return null;
  return Response.json(meteredAiErrorBody(classified), { status: classified.status });
}
