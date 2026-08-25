/**
 * Catalog defaults for marketing + product billing copy.
 * Neon `pricing_plans` / `plan_entitlement_versions` are the runtime source of truth after
 * migration; keep this file in sync when changing prices. Stripe Price IDs are never invented
 * here — update Dashboard / admin-configured `stripe_price_id` values to match.
 *
 * THE PRICING LADDER (2026-08-24, migration 0481):
 * - Four team plans: Free $0 · Pro $20 · Pro+ $60 · Max $100 per month.
 * - EVERY FEATURE ON EVERY PLAN, including Free. Nothing is feature-gated by plan;
 *   plans differ ONLY in the hosted AI allowance layered on top of BYOK.
 * - BYOK / local on every plan including Free: any provider key (OpenAI, Anthropic,
 *   Google AI Studio, OpenRouter, Groq, Mistral, anything OpenAI-compatible) or a
 *   local endpoint (Ollama / LM Studio). Unlimited by Vantage — you pay your provider.
 *
 * Hosted allowance sizing (kept below price for margin):
 * - Pro  $20 → $12 hosted · Pro+ $60 → $40 hosted · Max $100 → $70 hosted.
 * At the 0.75× hosted debit, $70 of credits covers ≈ $93 of provider list; with
 * wholesale capacity ≈ 0.5× list the worst-case provider cost is ≈ $47 on a $100
 * plan — comfortably above the SQL `plan_margin_guard` floor (0031 pass-through
 * rule: price must cover Stripe fees 2.9% + $0.30, $2 infra, 5% support reserve).
 * Allowance stays 60–70% of price at every paid rung so a fully-drained month
 * still carries fees, infra, and support without relying on breakage.
 * - Free $3 is a budget-class allowance only: routed to the sponsored provider pool
 *   (Mistral Small, Groq Llama 3.1 8B, Cohere Command R, Cerebras Llama 3.1) or the
 *   OpenRouter free-model router — real, already-wired providers; never frontier models.
 *
 * Hosted API economics (internal — do not expose wholesale to users):
 * - Hosted metered debit = 0.75× typical list → users save ~25% vs BYOK (1.0× at the provider)
 */

/** Canonical plan codes for the current ladder. All paid plans are team-wide. */
export type CatalogPlanCode = "free" | "pro" | "pro_plus" | "max" | "team_trial";

/**
 * Pre-ladder plan codes still present in old org rows / Stripe subscription
 * metadata. Migration 0481 remaps org rows; these aliases keep old references
 * resolving to the live plan they map to:
 * free→free · access/individual_pro/individual_max→pro · team_pro→pro_plus · team_max→max.
 */
export type LegacyCatalogPlanCode =
  | "access"
  | "individual_pro"
  | "individual_max"
  | "team_pro"
  | "team_max";

export type CatalogPlan = {
  code: CatalogPlanCode;
  label: string;
  /** Monthly subscription USD (0 for free / trial). */
  monthlyUsd: number;
  /** Included hosted AI allowance USD per period (Free's is budget-class models). */
  includedAllowanceUsd: number;
  scope: "free" | "org" | "trial";
  /** One line of what the hosted allowance buys on this plan. */
  hostedNote: string;
};

/**
 * Hosted Usage Credits debit vs typical provider list rates.
 * 0.75× ⇒ $1 list API costs 0.75 credits (~25% cheaper than BYOK at 1.0×).
 */
export const CATALOG_SERVICE_MULTIPLIER = 0.75;

/** Typical BYOK cost multiplier (user pays provider list directly). */
export const BYOK_LIST_MULTIPLIER = 1;

export const TEAM_TRIAL_DAYS = 7;

const FREE_PLAN: CatalogPlan = {
  code: "free",
  label: "Free",
  monthlyUsd: 0,
  // Budget-class hosted allowance (sponsored pool / OpenRouter free router), not frontier.
  includedAllowanceUsd: 3,
  scope: "free",
  hostedNote: "$3/mo hosted allowance on budget models (Mistral / Llama-class)",
};

const PRO_PLAN: CatalogPlan = {
  code: "pro",
  label: "Pro",
  monthlyUsd: 20,
  includedAllowanceUsd: 12,
  scope: "org",
  hostedNote: "$12/mo hosted allowance on frontier models",
};

const PRO_PLUS_PLAN: CatalogPlan = {
  code: "pro_plus",
  label: "Pro+",
  monthlyUsd: 60,
  includedAllowanceUsd: 40,
  scope: "org",
  hostedNote: "$40/mo hosted allowance on frontier models",
};

const MAX_PLAN: CatalogPlan = {
  code: "max",
  label: "Max",
  monthlyUsd: 100,
  includedAllowanceUsd: 70,
  scope: "org",
  hostedNote: "$70/mo hosted allowance on frontier models",
};

const TEAM_TRIAL_PLAN: CatalogPlan = {
  code: "team_trial",
  label: "Week team trial",
  monthlyUsd: 0,
  // Roughly a week's slice of the Max allowance; admin-granted, never auto-charged.
  includedAllowanceUsd: 15,
  scope: "trial",
  hostedNote: "$15 hosted allowance for the trial week",
};

/**
 * Legacy keys are aliases to the live plan each maps to (0481 remap), so existing
 * consumers (`PRICING_CATALOG.team_pro` etc.) keep rendering current prices.
 */
export const PRICING_CATALOG: Record<CatalogPlanCode | LegacyCatalogPlanCode, CatalogPlan> = {
  free: FREE_PLAN,
  pro: PRO_PLAN,
  pro_plus: PRO_PLUS_PLAN,
  max: MAX_PLAN,
  team_trial: TEAM_TRIAL_PLAN,
  // Legacy aliases — do not use for new UI; kept for old org rows / Stripe metadata.
  access: PRO_PLAN,
  individual_pro: PRO_PLAN,
  individual_max: PRO_PLAN,
  team_pro: PRO_PLUS_PLAN,
  team_max: MAX_PLAN,
};

/** Legacy → canonical plan-code mapping used by migration 0481 and old Stripe metadata. */
export const LEGACY_PLAN_CODE_MAP: Record<LegacyCatalogPlanCode, CatalogPlanCode> = {
  access: "pro",
  individual_pro: "pro",
  individual_max: "pro",
  team_pro: "pro_plus",
  team_max: "max",
};

/** Resolve any stored plan code (current or legacy) to a canonical ladder code. */
export function canonicalPlanCode(code: string | null | undefined): CatalogPlanCode {
  const normalized = (code ?? "free").trim().toLowerCase();
  if (normalized in LEGACY_PLAN_CODE_MAP) {
    return LEGACY_PLAN_CODE_MAP[normalized as LegacyCatalogPlanCode];
  }
  if (normalized === "pro" || normalized === "pro_plus" || normalized === "max" || normalized === "team_trial") {
    return normalized;
  }
  return "free";
}

export function formatCatalogUsd(amount: number): string {
  return `$${amount}`;
}

/** The one-sentence value statement the whole pricing surface leads with. */
export function everyPlanValueLine(): string {
  return "Everything is included on every plan. Paid plans add hosted AI so you don't need your own keys.";
}

/** BYOK / local story — true on every plan including Free. */
export function byokEveryPlanCopy(): string {
  return (
    "Bring any provider key — OpenAI, Anthropic, Google AI Studio, OpenRouter, Groq, Mistral, " +
    "or anything OpenAI-compatible — or point Vantage at a local endpoint (Ollama, LM Studio). " +
    "Unlimited by Vantage on every plan; you pay your provider directly."
  );
}

/** Honest description of what Free's hosted allowance runs on (real, wired providers). */
export function freeHostedModelClassCopy(): string {
  return (
    "Free's hosted allowance runs on budget-class models (Mistral Small / Llama-class via the " +
    "sponsored provider pool, or OpenRouter's free-model router) — not frontier models."
  );
}

/** Typical list-API value covered by a purchased Usage Credit pack at the hosted multiplier. */
export function hostedCreditPackListApiUsd(purchaseUsd: number): number {
  return Math.round(purchaseUsd / CATALOG_SERVICE_MULTIPLIER);
}

/** Soft marketing line for hosted credits vs BYOK (no wholesale; avoid wallet-style allotment talk). */
export function hostedApiSavingsCopy(): string {
  return "Credits go further than bringing your own keys—with the full product built in.";
}

/** One optional soft economics line (~25%) for pricing footnotes — not plan-card headers. */
export function hostedApiEconomicsSoftLine(): string {
  return "Hosted credits bill below typical API list rates—about 25% less than the same models on your own keys.";
}

/** Compact debit explanation for budgets / admin (not plan-card marketing). */
export function hostedUsageDebitCopy(): string {
  return (
    `Hosted Usage Credits debit at ${CATALOG_SERVICE_MULTIPLIER}× typical provider list ` +
    `(~25% less than BYOK at ${BYOK_LIST_MULTIPLIER}×).`
  );
}

/** Short strip for Soft-UI waitlist / home / sign-in CTAs — the full four-plan ladder. */
export function raisedPricingStrip(): Array<{ id: string; label: string; price: string }> {
  return [
    { id: "free", label: "Free", price: formatCatalogUsd(FREE_PLAN.monthlyUsd) },
    { id: "pro", label: "Pro", price: formatCatalogUsd(PRO_PLAN.monthlyUsd) },
    { id: "pro_plus", label: "Pro+", price: formatCatalogUsd(PRO_PLUS_PLAN.monthlyUsd) },
    { id: "max", label: "Max", price: formatCatalogUsd(MAX_PLAN.monthlyUsd) },
  ];
}

/** One-line ladder for waitlist / pricing CTAs. */
export function raisedPricingSummaryLine(): string {
  return (
    `Free $${FREE_PLAN.monthlyUsd} · Pro $${PRO_PLAN.monthlyUsd} · Pro+ $${PRO_PLUS_PLAN.monthlyUsd} · ` +
    `Max $${MAX_PLAN.monthlyUsd} — every feature on every plan`
  );
}

/** Full catalog defaults footnote (pricing page — soft framing, no allotment headlines). */
export function catalogDefaultsFootnote(): string {
  return (
    `Catalog defaults: Free $0 (with a $${FREE_PLAN.includedAllowanceUsd} budget-model hosted allowance) · ` +
    `Pro $${PRO_PLAN.monthlyUsd} ($${PRO_PLAN.includedAllowanceUsd} hosted) · ` +
    `Pro+ $${PRO_PLUS_PLAN.monthlyUsd} ($${PRO_PLUS_PLAN.includedAllowanceUsd} hosted) · ` +
    `Max $${MAX_PLAN.monthlyUsd} ($${MAX_PLAN.includedAllowanceUsd} hosted) · ` +
    `Week team trial ${TEAM_TRIAL_DAYS} days · Every feature on every plan; BYOK/local unlimited by Vantage · ` +
    `Hosted credits debit at ${CATALOG_SERVICE_MULTIPLIER}× typical list (~25% vs BYOK).`
  );
}

/** Paid-ladder monthly range for alternate-path copy. */
export function teamCommitRangeCopy(): string {
  return `$${PRO_PLAN.monthlyUsd}–$${MAX_PLAN.monthlyUsd}`;
}
