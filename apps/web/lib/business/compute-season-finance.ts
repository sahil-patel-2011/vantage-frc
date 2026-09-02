import type { PoolClient } from "@neondatabase/serverless";
import { grantIdOrNull, loadGrantOptions, type GrantOption } from "../finance/grant-options";
import { seasonFinanceNextActions, type SeasonFinanceNextAction } from "./season-finance-next-actions";

export const FUNDING_KINDS = [
  "school",
  "student_fees",
  "grant",
  "sponsor",
  "fundraiser",
  "in_kind",
  "other",
] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

export const FUNDING_KIND_LABELS: Record<FundingKind, string> = {
  school: "School / district funds",
  student_fees: "Student fees / dues",
  grant: "Grant award",
  sponsor: "Sponsor cash",
  fundraiser: "Fundraiser deposit",
  in_kind: "In-kind gift",
  other: "Other income",
};

/**
 * ONE SOURCE OF TRUTH PER FUNDING KIND (0504 double-count fix).
 *
 * The funding desk lets a treasurer type a "Sponsor cash" / "Grant award" /
 * "Fundraiser deposit" line, but those same dollars are ALSO recorded on their
 * own surfaces: sponsor_contributions (Sponsors), grant_applications.status =
 * 'awarded' (Grants) and fundraiser_events.proceeds_usd (Fundraisers). Until
 * this fix `receivedIncomeCents` summed every funding line AND the three
 * satellite totals, so a $5,000 sponsor check entered on both surfaces showed
 * up as $10,000 raised.
 *
 * Rule: for these three kinds the SATELLITE table is the source of truth for
 * money received. A funding-desk line of that kind is a plan (its planned
 * amount still counts toward the income plan) and its received amount is
 * reported separately as `fundingReceivedSatelliteCents` — never added to
 * received income. Every other kind (school, student fees, in-kind, other)
 * has no satellite and is counted from the desk line as before.
 */
export const SATELLITE_FUNDING_KINDS: readonly FundingKind[] = ["grant", "sponsor", "fundraiser"];

export function countsTowardReceivedIncome(kind: FundingKind | undefined): boolean {
  return kind == null || !SATELLITE_FUNDING_KINDS.includes(kind);
}

export const PAYMENT_METHODS = [
  "card",
  "cash",
  "check",
  "reimbursement",
  "purchase_order",
  "in_kind",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card / team account",
  cash: "Cash",
  check: "Check",
  reimbursement: "Reimbursement owed",
  purchase_order: "Purchase order",
  in_kind: "In-kind",
  other: "Other",
};

export type SeasonFinanceSetupStep = { id: string; label: string; detail: string; href: string };

export type FundingSourceRow = {
  id: string;
  kind: FundingKind;
  name: string;
  plannedCents: number;
  receivedCents: number;
  receivedOn: string | null;
  notes: string | null;
};

export type PurchaseLogRow = {
  id: string;
  purchasedOn: string;
  vendor: string;
  item: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  paymentMethod: PaymentMethod;
  receiptUrl: string | null;
  purchaseRequestId: string | null;
  reimbursedOn: string | null;
  notes: string | null;
  loggedByName: string;
  /** Grant this receipt is attributed to (0504), for the grant report. */
  grantApplicationId: string | null;
  grantName: string | null;
};

export type SeasonFinanceCategory = {
  id: string;
  name: string;
  allocatedCents: number;
};

export type SeasonFinanceRollup = {
  plannedIncomeCents: number;
  receivedIncomeCents: number;
  remainingToRaiseCents: number;
  plannedSpendCents: number;
  actualSpendCents: number;
  committedSpendCents: number;
  remainingToSpendCents: number;
  cashPositionCents: number;
  reimbursementOpenCents: number;
  fundingPlannedCents: number;
  /** Every funding-desk line's received amount, as typed (display only). */
  fundingReceivedCents: number;
  /** Desk lines whose kind has no satellite table — the part that counts as income. */
  fundingReceivedCountedCents: number;
  /** Desk lines of kind grant / sponsor / fundraiser — counted from their satellites instead. */
  fundingReceivedSatelliteCents: number;
  /** fundraiser_events.expenses_usd across the season (0504) — money out. */
  fundraiserExpensesCents: number;
  sponsorCashCents: number;
  sponsorInKindCents: number;
  grantAwardedCents: number;
  fundraiserProceedsCents: number;
  fundraiserGoalCents: number;
  purchaseLogCents: number;
  poRequestedCents: number;
  poCommittedCents: number;
  poSpentCents: number;
  seasonCostsPaidCents: number;
};

export type SeasonFinanceView =
  | {
      status: "setup_required";
      message: string;
      steps: SeasonFinanceSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      role: string;
      canManageFinance: boolean;
      seasonYear: number;
      seasons: number[];
      operatingBudgetCents: number;
      fundraisingGoalCents: number;
      categories: SeasonFinanceCategory[];
      funding: FundingSourceRow[];
      purchases: PurchaseLogRow[];
      /** Grants an expense can be tagged to (0504). */
      grants: GrantOption[];
      rollup: SeasonFinanceRollup;
      nextActions: SeasonFinanceNextAction[];
      computedAt: string;
    };

export function isFundingKind(value: unknown): value is FundingKind {
  return typeof value === "string" && (FUNDING_KINDS as readonly string[]).includes(value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function currentFinanceSeason(now = new Date()): number {
  return now.getUTCFullYear();
}

export function validFinanceSeason(value: unknown, fallback = currentFinanceSeason()): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2000 && number <= 3000 ? number : fallback;
}

export function usdToCents(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

export function dollarsToUsd(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return null;
  return Math.round(amount * 100) / 100;
}

export function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function trimmedOrNull(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function webUrlOrNull(value: unknown): string | null {
  const candidate = trimmedOrNull(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function rollupSeasonFinance(input: {
  /** `kind` is optional so pure callers can omit it; a missing kind counts (no satellite). */
  funding: Array<{ kind?: FundingKind; plannedCents: number; receivedCents: number }>;
  purchases: Array<{ amountCents: number; paymentMethod: PaymentMethod; reimbursedOn: string | null }>;
  operatingBudgetCents: number;
  fundraisingGoalCents: number;
  categoryAllocatedCents: number;
  sponsorCashCents: number;
  sponsorInKindCents: number;
  grantAwardedCents: number;
  fundraiserProceedsCents: number;
  fundraiserGoalCents: number;
  /** Money spent running fundraisers (0504). Optional for pure callers; defaults to 0. */
  fundraiserExpensesCents?: number;
  poRequestedCents: number;
  poCommittedCents: number;
  poSpentCents: number;
  seasonCostsPaidCents: number;
}): SeasonFinanceRollup {
  const fundingPlannedCents = input.funding.reduce((sum, row) => sum + row.plannedCents, 0);
  const fundingReceivedCents = input.funding.reduce((sum, row) => sum + row.receivedCents, 0);
  // See SATELLITE_FUNDING_KINDS: grant / sponsor / fundraiser desk lines are plans whose
  // received dollars are counted from their satellite tables, never here.
  const fundingReceivedCountedCents = input.funding
    .filter((row) => countsTowardReceivedIncome(row.kind))
    .reduce((sum, row) => sum + row.receivedCents, 0);
  const fundingReceivedSatelliteCents = fundingReceivedCents - fundingReceivedCountedCents;
  const fundraiserExpensesCents = Math.max(0, input.fundraiserExpensesCents ?? 0);
  const purchaseLogCents = input.purchases.reduce((sum, row) => sum + row.amountCents, 0);
  const reimbursementOpenCents = input.purchases
    .filter((row) => row.paymentMethod === "reimbursement" && !row.reimbursedOn)
    .reduce((sum, row) => sum + row.amountCents, 0);

  const plannedIncomeCents =
    fundingPlannedCents > 0
      ? fundingPlannedCents
      : input.fundraisingGoalCents + input.fundraiserGoalCents;
  const receivedIncomeCents =
    fundingReceivedCountedCents + input.sponsorCashCents + input.grantAwardedCents + input.fundraiserProceedsCents;
  const plannedSpendCents =
    input.categoryAllocatedCents > 0 ? input.categoryAllocatedCents : input.operatingBudgetCents;
  const actualSpendCents =
    purchaseLogCents + input.poSpentCents + input.seasonCostsPaidCents + fundraiserExpensesCents;
  const committedSpendCents =
    purchaseLogCents + input.poCommittedCents + input.seasonCostsPaidCents + fundraiserExpensesCents;

  return {
    plannedIncomeCents,
    receivedIncomeCents,
    remainingToRaiseCents: Math.max(0, plannedSpendCents - receivedIncomeCents),
    plannedSpendCents,
    actualSpendCents,
    committedSpendCents,
    remainingToSpendCents: plannedSpendCents - actualSpendCents,
    cashPositionCents: receivedIncomeCents - actualSpendCents,
    reimbursementOpenCents,
    fundingPlannedCents,
    fundingReceivedCents,
    fundingReceivedCountedCents,
    fundingReceivedSatelliteCents,
    fundraiserExpensesCents,
    sponsorCashCents: input.sponsorCashCents,
    sponsorInKindCents: input.sponsorInKindCents,
    grantAwardedCents: input.grantAwardedCents,
    fundraiserProceedsCents: input.fundraiserProceedsCents,
    fundraiserGoalCents: input.fundraiserGoalCents,
    purchaseLogCents,
    poRequestedCents: input.poRequestedCents,
    poCommittedCents: input.poCommittedCents,
    poSpentCents: input.poSpentCents,
    seasonCostsPaidCents: input.seasonCostsPaidCents,
  };
}

function setup(message: string, orgId: string | null, seasonYear: number): SeasonFinanceView {
  const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  return {
    status: "setup_required",
    message,
    orgId,
    seasonYear,
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization.", href: "/workspace" },
      {
        id: "migrate",
        label: "Apply finance tables",
        detail: "Owners run npm run db:migrate so funding sources and the purchase log exist.",
        href: `/business${suffix}`,
      },
    ],
  };
}

function isMissingRelation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code: unknown }).code) === "42P01";
}

export async function computeSeasonFinanceView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SeasonFinanceView> {
  const seasonYear = validFinanceSeason(input.seasonYear);
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Select a team workspace to plan season funding, purchases, and sponsorships.", null, seasonYear);

  const orgId = org.orgId;
  const canManageFinance = org.role === "owner" || org.role === "admin";

  try {
    const [
      seasonResult,
      categoriesResult,
      fundingResult,
      purchaseResult,
      sponsorResult,
      grantResult,
      fundraiserResult,
      poResult,
      costsResult,
      seasonsResult,
      grants,
    ] = await Promise.all([
      client.query<{ totalBudgetUsd: string; fundraisingGoalUsd: string }>(
        `SELECT COALESCE(operating_budget_usd, 0)::text AS "totalBudgetUsd",
                COALESCE(fundraising_goal_usd, 0)::text AS "fundraisingGoalUsd"
         FROM finance_season_settings WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ id: string; name: string; allocatedUsd: string }>(
        `SELECT c.id, c.name, COALESCE(p.total_limit_usd, 0)::text AS "allocatedUsd"
         FROM finance_categories c
         LEFT JOIN finance_budget_plans p ON p.category_id = c.id AND p.org_id = c.org_id
         WHERE c.org_id = $1 AND c.season_year = $2 ORDER BY c.name`,
        [orgId, seasonYear],
      ),
      client.query<{
        id: string;
        kind: FundingKind;
        name: string;
        plannedUsd: string;
        receivedUsd: string;
        receivedOn: string | null;
        notes: string | null;
      }>(
        `SELECT id, kind, name, planned_usd::text AS "plannedUsd", received_usd::text AS "receivedUsd",
                received_on::text AS "receivedOn", notes
         FROM finance_funding_sources
         WHERE org_id = $1 AND season_year = $2
         ORDER BY kind, name`,
        [orgId, seasonYear],
      ),
      client.query<{
        id: string;
        purchasedOn: string;
        vendor: string;
        item: string;
        categoryId: string | null;
        categoryName: string | null;
        amountUsd: string;
        paymentMethod: PaymentMethod;
        receiptUrl: string | null;
        purchaseRequestId: string | null;
        reimbursedOn: string | null;
        notes: string | null;
        loggedByName: string;
        grantApplicationId: string | null;
        grantName: string | null;
      }>(
        `SELECT l.id, l.purchased_on::text AS "purchasedOn", l.vendor, l.item,
                l.category_id AS "categoryId", c.name AS "categoryName",
                l.amount_usd::text AS "amountUsd", l.payment_method AS "paymentMethod",
                l.receipt_url AS "receiptUrl", l.purchase_request_id AS "purchaseRequestId",
                l.reimbursed_on::text AS "reimbursedOn", l.notes,
                CASE WHEN l.created_by = current_app_user_id() THEN 'You' ELSE 'Team member' END AS "loggedByName",
                l.grant_application_id AS "grantApplicationId",
                CASE WHEN l.grant_application_id IS NULL THEN NULL ELSE COALESCE(go.name, 'Grant') END AS "grantName"
         FROM finance_purchase_log l
         LEFT JOIN finance_categories c ON c.id = l.category_id AND c.org_id = l.org_id
         LEFT JOIN grant_applications ga ON ga.id = l.grant_application_id
         LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
         WHERE l.org_id = $1 AND l.season_year = $2
         ORDER BY l.purchased_on DESC, l.created_at DESC
         LIMIT 400`,
        [orgId, seasonYear],
      ),
      client.query<{ cashUsd: string; inKindUsd: string }>(
        `SELECT COALESCE(SUM(amount_usd) FILTER (WHERE type = 'cash'), 0)::text AS "cashUsd",
                COALESCE(SUM(COALESCE(estimated_value_usd, amount_usd)) FILTER (WHERE type IN ('in_kind','discount')), 0)::text AS "inKindUsd"
         FROM sponsor_contributions
         WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ awardedUsd: string }>(
        `SELECT COALESCE(SUM(amount_awarded_usd), 0)::text AS "awardedUsd"
         FROM grant_applications
         WHERE org_id = $1 AND season_year = $2 AND status = 'awarded'`,
        [orgId, seasonYear],
      ),
      client.query<{ proceedsUsd: string; goalUsd: string; expensesUsd: string }>(
        `SELECT COALESCE(SUM(proceeds_usd), 0)::text AS "proceedsUsd",
                COALESCE(SUM(goal_usd), 0)::text AS "goalUsd",
                COALESCE(SUM(expenses_usd), 0)::text AS "expensesUsd"
         FROM fundraiser_events
         WHERE org_id = $1 AND season_year = $2 AND status <> 'cancelled'`,
        [orgId, seasonYear],
      ),
      client.query<{ requestedUsd: string; committedUsd: string; spentUsd: string }>(
        `SELECT
           COALESCE(SUM(total_cost_usd) FILTER (WHERE status = 'pending'), 0)::text AS "requestedUsd",
           COALESCE(SUM(total_cost_usd) FILTER (WHERE status IN ('approved','ordered','received','reimbursed')), 0)::text AS "committedUsd",
           COALESCE(SUM(total_cost_usd) FILTER (WHERE status IN ('ordered','received','reimbursed')), 0)::text AS "spentUsd"
         FROM purchase_requests
         WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ paidUsd: string }>(
        `SELECT COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid'), 0)::text AS "paidUsd"
         FROM season_costs WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ seasonYear: number }>(
        `SELECT DISTINCT season_year AS "seasonYear" FROM (
           SELECT season_year FROM finance_season_settings WHERE org_id = $1
           UNION ALL SELECT season_year FROM finance_funding_sources WHERE org_id = $1
           UNION ALL SELECT season_year FROM finance_purchase_log WHERE org_id = $1
           UNION ALL SELECT season_year FROM finance_categories WHERE org_id = $1
           UNION ALL SELECT $2::integer
         ) seasons ORDER BY season_year DESC`,
        [orgId, seasonYear],
      ),
      loadGrantOptions(client, orgId),
    ]);

    const categories: SeasonFinanceCategory[] = categoriesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      allocatedCents: usdToCents(row.allocatedUsd),
    }));
    const funding: FundingSourceRow[] = fundingResult.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      plannedCents: usdToCents(row.plannedUsd),
      receivedCents: usdToCents(row.receivedUsd),
      receivedOn: row.receivedOn,
      notes: row.notes,
    }));
    const purchases: PurchaseLogRow[] = purchaseResult.rows.map((row) => ({
      id: row.id,
      purchasedOn: row.purchasedOn,
      vendor: row.vendor,
      item: row.item,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      amountCents: usdToCents(row.amountUsd),
      paymentMethod: isPaymentMethod(row.paymentMethod) ? row.paymentMethod : "other",
      receiptUrl: row.receiptUrl,
      purchaseRequestId: row.purchaseRequestId,
      reimbursedOn: row.reimbursedOn,
      notes: row.notes,
      loggedByName: row.loggedByName,
      grantApplicationId: row.grantApplicationId,
      grantName: row.grantName,
    }));

    const operatingBudgetCents = usdToCents(seasonResult.rows[0]?.totalBudgetUsd);
    const fundraisingGoalCents = usdToCents(seasonResult.rows[0]?.fundraisingGoalUsd);
    const rollup = rollupSeasonFinance({
      funding,
      purchases,
      operatingBudgetCents,
      fundraisingGoalCents,
      categoryAllocatedCents: categories.reduce((sum, row) => sum + row.allocatedCents, 0),
      sponsorCashCents: usdToCents(sponsorResult.rows[0]?.cashUsd),
      sponsorInKindCents: usdToCents(sponsorResult.rows[0]?.inKindUsd),
      grantAwardedCents: usdToCents(grantResult.rows[0]?.awardedUsd),
      fundraiserProceedsCents: usdToCents(fundraiserResult.rows[0]?.proceedsUsd),
      fundraiserGoalCents: usdToCents(fundraiserResult.rows[0]?.goalUsd),
      fundraiserExpensesCents: usdToCents(fundraiserResult.rows[0]?.expensesUsd),
      poRequestedCents: usdToCents(poResult.rows[0]?.requestedUsd),
      poCommittedCents: usdToCents(poResult.rows[0]?.committedUsd),
      poSpentCents: usdToCents(poResult.rows[0]?.spentUsd),
      seasonCostsPaidCents: usdToCents(costsResult.rows[0]?.paidUsd),
    });

    return {
      status: "live",
      orgId,
      orgName: org.orgName,
      teamNumber: org.teamNumber,
      role: org.role,
      canManageFinance,
      seasonYear,
      seasons: seasonsResult.rows.map((row) => row.seasonYear),
      operatingBudgetCents,
      fundraisingGoalCents,
      categories,
      funding,
      purchases,
      grants,
      rollup,
      nextActions: seasonFinanceNextActions({
        orgId,
        seasonYear,
        fundingCount: funding.length,
        purchaseCount: purchases.length,
        plannedSpendCents: rollup.plannedSpendCents,
        remainingToRaiseCents: rollup.remainingToRaiseCents,
        reimbursementOpenCents: rollup.reimbursementOpenCents,
        canManageFinance,
      }),
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return setup("Season finance tables are not installed yet. Run database migrations, then reload.", orgId, seasonYear);
    }
    throw error;
  }
}

export type FundingSourceInput = {
  kind: FundingKind;
  name: string;
  plannedUsd: number;
  receivedUsd: number;
  receivedOn: string | null;
  notes: string | null;
};

export function parseFundingSourceInput(body: Record<string, unknown>): FundingSourceInput {
  if (!isFundingKind(body.kind)) throw new Error("Choose a funding kind (school, fees, grant, sponsor, fundraiser, in-kind, or other).");
  const name = trimmedOrNull(body.name, 200);
  if (!name) throw new Error("Funding source name is required.");
  const plannedUsd = dollarsToUsd(body.plannedUsd ?? body.plannedDollars) ?? 0;
  const receivedUsd = dollarsToUsd(body.receivedUsd ?? body.receivedDollars) ?? 0;
  return {
    kind: body.kind,
    name,
    plannedUsd,
    receivedUsd,
    receivedOn: isoDateOrNull(body.receivedOn),
    notes: trimmedOrNull(body.notes, 4_000),
  };
}

export type PurchaseLogInput = {
  purchasedOn: string;
  vendor: string;
  item: string;
  categoryId: string | null;
  amountUsd: number;
  paymentMethod: PaymentMethod;
  receiptUrl: string | null;
  notes: string | null;
  reimbursedOn: string | null;
  /** Optional grant to attribute this receipt to (0504). */
  grantApplicationId: string | null;
};

export function parsePurchaseLogInput(body: Record<string, unknown>): PurchaseLogInput {
  const purchasedOn = isoDateOrNull(body.purchasedOn);
  if (!purchasedOn) throw new Error("Purchase date is required.");
  const vendor = trimmedOrNull(body.vendor, 200);
  if (!vendor) throw new Error("Vendor is required.");
  const item = trimmedOrNull(body.item, 400);
  if (!item) throw new Error("What you bought is required.");
  const amountUsd = dollarsToUsd(body.amountUsd ?? body.amountDollars);
  if (amountUsd == null) throw new Error("Amount must be zero or greater.");
  const paymentMethod = isPaymentMethod(body.paymentMethod) ? body.paymentMethod : "other";
  const categoryId = typeof body.categoryId === "string" && body.categoryId.trim() ? body.categoryId.trim() : null;
  return {
    purchasedOn,
    vendor,
    item,
    categoryId,
    amountUsd,
    paymentMethod,
    receiptUrl: webUrlOrNull(body.receiptUrl),
    notes: trimmedOrNull(body.notes, 4_000),
    reimbursedOn: isoDateOrNull(body.reimbursedOn),
    grantApplicationId: grantIdOrNull(body.grantApplicationId),
  };
}
