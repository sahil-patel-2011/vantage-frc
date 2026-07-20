/**
 * Catalog defaults for marketing + product billing copy.
 * Neon `pricing_plans` / `plan_entitlement_versions` are the runtime source of truth after
 * migration; keep this file in sync when raising prices. Stripe Price IDs are never invented
 * here — update Dashboard / admin-configured `stripe_price_id` values to match.
 *
 * Capability raise (2026-07-20): Soft-UI hubs, scouting trust, competition ops, CAD/strategy/AI.
 * Usage Credits remain 1.0× (no Vantage markup on provider list rates).
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

/** Launch debit: 1 Usage Credit = $1 provider API at list rates. */
export const CATALOG_SERVICE_MULTIPLIER = 1;

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
    monthlyUsd: 79,
    includedAllowanceUsd: 0,
    scope: "user",
  },
  individual_pro: {
    code: "individual_pro",
    label: "Individual Pro",
    monthlyUsd: 129,
    includedAllowanceUsd: 75,
    scope: "user",
  },
  individual_max: {
    code: "individual_max",
    label: "Individual Max",
    monthlyUsd: 189,
    includedAllowanceUsd: 130,
    scope: "user",
  },
  team_pro: {
    code: "team_pro",
    label: "Team Pro",
    monthlyUsd: 349,
    includedAllowanceUsd: 225,
    scope: "org",
  },
  team_max: {
    code: "team_max",
    label: "Team Max",
    monthlyUsd: 649,
    includedAllowanceUsd: 450,
    scope: "org",
  },
  team_trial: {
    code: "team_trial",
    label: "Week team trial",
    monthlyUsd: 0,
    includedAllowanceUsd: 45,
    scope: "trial",
  },
};

export function formatCatalogUsd(amount: number): string {
  return `$${amount}`;
}

/** Short strip for Soft-UI waitlist / home / sign-in CTAs. */
export function raisedPricingStrip(): Array<{ id: string; label: string; price: string }> {
  const access = PRICING_CATALOG.access;
  const pro = PRICING_CATALOG.individual_pro;
  const max = PRICING_CATALOG.individual_max;
  const teamPro = PRICING_CATALOG.team_pro;
  const teamMax = PRICING_CATALOG.team_max;
  return [
    { id: "access", label: "Access", price: formatCatalogUsd(access.monthlyUsd) },
    {
      id: "individual",
      label: "Individual Pro / Max",
      price: `${formatCatalogUsd(pro.monthlyUsd)} / ${formatCatalogUsd(max.monthlyUsd)}`,
    },
    {
      id: "team",
      label: "Team Pro / Max",
      price: `${formatCatalogUsd(teamPro.monthlyUsd)} / ${formatCatalogUsd(teamMax.monthlyUsd)}`,
    },
  ];
}

/** One-line raised catalog for waitlist / pricing CTAs. */
export function raisedPricingSummaryLine(): string {
  const a = PRICING_CATALOG.access.monthlyUsd;
  const ip = PRICING_CATALOG.individual_pro.monthlyUsd;
  const im = PRICING_CATALOG.individual_max.monthlyUsd;
  const tp = PRICING_CATALOG.team_pro.monthlyUsd;
  const tm = PRICING_CATALOG.team_max.monthlyUsd;
  return `Access $${a} · Individual $${ip}/$${im} · Team $${tp}/$${tm}`;
}

/** Full catalog defaults footnote (pricing page economics section). */
export function catalogDefaultsFootnote(): string {
  const c = PRICING_CATALOG;
  return (
    `Catalog defaults: Free $0 / $0 API · Individual Pro $${c.individual_pro.monthlyUsd} / $${c.individual_pro.includedAllowanceUsd} · ` +
    `Individual Max $${c.individual_max.monthlyUsd} / $${c.individual_max.includedAllowanceUsd} · Team Pro $${c.team_pro.monthlyUsd} / ` +
    `$${c.team_pro.includedAllowanceUsd} · Team Max $${c.team_max.monthlyUsd} / $${c.team_max.includedAllowanceUsd} · ` +
    `Access $${c.access.monthlyUsd} + PAYG · Week team trial $${c.team_trial.includedAllowanceUsd} API / ${TEAM_TRIAL_DAYS} days.`
  );
}

/** Team Pro–Max monthly range for alternate-path copy. */
export function teamCommitRangeCopy(): string {
  return `$${PRICING_CATALOG.team_pro.monthlyUsd}–$${PRICING_CATALOG.team_max.monthlyUsd}`;
}
