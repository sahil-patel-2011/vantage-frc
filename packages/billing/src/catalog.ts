/**
 * Catalog defaults for marketing + product billing copy.
 * Neon `pricing_plans` / `plan_entitlement_versions` are the runtime source of truth after
 * migration; keep this file in sync when changing prices. Stripe Price IDs are never invented
 * here — update Dashboard / admin-configured `stripe_price_id` values to match.
 *
 * Appealing pricing (2026-07-20): slightly lower Soft-UI / ops ladder for conversion.
 *
 * Hosted API economics (internal — do not expose wholesale to users):
 * - Wholesale capacity ≈ 0.5× typical provider list → Vantage margin ≈ 0.25× of list
 * - Hosted metered debit = 0.75× typical list → users save ~25% vs BYOK (1.0× at the provider)
 * - BYOK / supply-your-own-key ≈ 1.0× list paid directly to the provider (no Vantage markup)
 */

export type CatalogPlanCode =
  | "free"
  | "access"
  | "individual_pro"
  | "individual_max"
  | "team_pro"
  | "team_max"
  | "team_trial";

export type CatalogPlan = {
  code: CatalogPlanCode;
  label: string;
  /** Monthly subscription USD (0 for free / trial). */
  monthlyUsd: number;
  /** Included managed API allowance USD per paid period (0 for Access / Free). */
  includedAllowanceUsd: number;
  scope: "free" | "user" | "org" | "trial";
};

/**
 * Hosted Usage Credits debit vs typical provider list rates.
 * 0.75× ⇒ $1 list API costs 0.75 credits (~25% cheaper than BYOK at 1.0×).
 */
export const CATALOG_SERVICE_MULTIPLIER = 0.75;

/** Typical BYOK cost multiplier (user pays provider list directly). */
export const BYOK_LIST_MULTIPLIER = 1;

export const TEAM_TRIAL_DAYS = 7;

export const PRICING_CATALOG: Record<CatalogPlanCode, CatalogPlan> = {
  free: {
    code: "free",
    label: "Free",
    monthlyUsd: 0,
    includedAllowanceUsd: 0,
    scope: "free",
  },
  access: {
    code: "access",
    label: "Access",
    monthlyUsd: 69,
    includedAllowanceUsd: 0,
    scope: "user",
  },
  individual_pro: {
    code: "individual_pro",
    label: "Individual Pro",
    monthlyUsd: 109,
    includedAllowanceUsd: 75,
    scope: "user",
  },
  individual_max: {
    code: "individual_max",
    label: "Individual Max",
    monthlyUsd: 159,
    includedAllowanceUsd: 130,
    scope: "user",
  },
  team_pro: {
    code: "team_pro",
    label: "Team Pro",
    monthlyUsd: 299,
    includedAllowanceUsd: 225,
    scope: "org",
  },
  team_max: {
    code: "team_max",
    label: "Team Max",
    monthlyUsd: 549,
    includedAllowanceUsd: 450,
    scope: "org",
  },
  team_trial: {
    code: "team_trial",
    label: "Week team trial",
    monthlyUsd: 0,
    includedAllowanceUsd: 39,
    scope: "trial",
  },
};

export function formatCatalogUsd(amount: number): string {
  return `$${amount}`;
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

/** Short strip for Soft-UI waitlist / home / sign-in CTAs. */
export function raisedPricingStrip(): Array<{ id: string; label: string; price: string }> {
  const pro = PRICING_CATALOG.individual_pro;
  const max = PRICING_CATALOG.individual_max;
  const teamPro = PRICING_CATALOG.team_pro;
  const teamMax = PRICING_CATALOG.team_max;
  return [
    { id: "free", label: "Free", price: "$0" },
    {
      id: "individual",
      label: "Individual",
      price: `${formatCatalogUsd(pro.monthlyUsd)} / ${formatCatalogUsd(max.monthlyUsd)}`,
    },
    {
      id: "team",
      label: "Team",
      price: `${formatCatalogUsd(teamPro.monthlyUsd)} / ${formatCatalogUsd(teamMax.monthlyUsd)}`,
    },
  ];
}

/** One-line raised catalog for waitlist / pricing CTAs. */
export function raisedPricingSummaryLine(): string {
  const ip = PRICING_CATALOG.individual_pro.monthlyUsd;
  const im = PRICING_CATALOG.individual_max.monthlyUsd;
  const tp = PRICING_CATALOG.team_pro.monthlyUsd;
  const tm = PRICING_CATALOG.team_max.monthlyUsd;
  const a = PRICING_CATALOG.access.monthlyUsd;
  return `Free $0 · Individual $${ip}/$${im} · Team $${tp}/$${tm} · Access $${a}`;
}

/** Full catalog defaults footnote (pricing page — soft framing, no allotment headlines). */
export function catalogDefaultsFootnote(): string {
  const c = PRICING_CATALOG;
  return (
    `Catalog defaults: Free $0 · Individual Pro $${c.individual_pro.monthlyUsd} · Individual Max $${c.individual_max.monthlyUsd} · ` +
    `Team Pro $${c.team_pro.monthlyUsd} · Team Max $${c.team_max.monthlyUsd} · Access $${c.access.monthlyUsd} + PAYG · ` +
    `Week team trial ${TEAM_TRIAL_DAYS} days · Hosted credits debit at ${CATALOG_SERVICE_MULTIPLIER}× typical list (~25% vs BYOK).`
  );
}

/** Team Pro–Max monthly range for alternate-path copy. */
export function teamCommitRangeCopy(): string {
  return `$${PRICING_CATALOG.team_pro.monthlyUsd}–$${PRICING_CATALOG.team_max.monthlyUsd}`;
}
