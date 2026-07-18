/** Display statuses for the platform-admin org plans ledger. */
export const BILLING_DISPLAY_STATUSES = ["free", "trial", "active", "past_due"] as const;
export type BillingDisplayStatus = (typeof BILLING_DISPLAY_STATUSES)[number];

export type OrgPlanRowInput = {
  planCode: string | null | undefined;
  entitlementStatus: string | null | undefined;
  entitlementSource: string | null | undefined;
};

const TERMINAL_STATUSES = new Set(["expired", "revoked", "canceled", "cancelled"]);

/**
 * Collapse entitlement/source/plan into the four filter statuses used on /admin/plans.
 * Missing entitlements and Free/BYOK rows surface as `free`.
 */
export function billingDisplayStatus(input: OrgPlanRowInput): BillingDisplayStatus {
  const plan = (input.planCode ?? "free").trim().toLowerCase();
  const status = (input.entitlementStatus ?? "").trim().toLowerCase();
  const source = (input.entitlementSource ?? "").trim().toLowerCase();

  if (status === "past_due") return "past_due";

  const isTrial =
    status === "trialing" || source === "admin_trial" || plan === "team_trial";
  if (isTrial && !TERMINAL_STATUSES.has(status)) return "trial";

  if (!status || plan === "free" || TERMINAL_STATUSES.has(status)) return "free";

  if (status === "active") return "active";

  // Unknown non-terminal paid-looking status — treat as active so it stays visible.
  return "active";
}

export type OrgPlanLedgerRow = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  planCode: string;
  planName: string;
  status: BillingDisplayStatus;
  entitlementStatus: string | null;
  entitlementSource: string | null;
  includedAllowanceUsd: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  memberCount: number;
  validUntil: string | null;
  trialEndsAt: string | null;
};

export type StripeWiringSnapshot = {
  secretConfigured: boolean;
  webhookConfigured: boolean;
  billingDbConfigured: boolean;
  plansWithStripePriceId: number;
  blockers: string[];
};

export function stripeWiringSnapshot(input: {
  secretConfigured: boolean;
  webhookConfigured: boolean;
  billingDbConfigured: boolean;
  plansWithStripePriceId: number;
}): StripeWiringSnapshot {
  const blockers: string[] = [];
  if (!input.secretConfigured) blockers.push("STRIPE_SECRET_KEY is not set");
  if (!input.webhookConfigured) blockers.push("STRIPE_WEBHOOK_SECRET is not set");
  if (!input.billingDbConfigured) blockers.push("DATABASE_BILLING_URL is not set (webhook role)");
  if (input.plansWithStripePriceId === 0) {
    blockers.push("No pricing_plans.stripe_price_id values — Checkout cannot start");
  }
  return { ...input, blockers };
}
