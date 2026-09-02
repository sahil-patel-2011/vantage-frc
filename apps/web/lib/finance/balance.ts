/**
 * Real money balance — the team's actual cash position derived from recorded
 * rows only. There is deliberately NO denormalized balance column anywhere:
 * every number here is recomputed from the underlying finance tables on read,
 * under the caller's RLS context (org membership enforced by row policies).
 *
 * Since 0461_money_unify.sql the UNIFIED LEDGER (finance_transactions +
 * source_kind/source_id) is read FIRST for every money movement the old spend
 * tables used to hold. The legacy unions survive ONLY as a fallback for rows
 * not yet mirrored (written by a consumer that has not been repointed through
 * lib/finance/ledger.ts). The dedup rule — a legacy row whose
 * (source_kind, source_id) already exists in the ledger is the same dollar and
 * is skipped — is enforced in SQL via NOT EXISTS and re-asserted in TS by
 * dedupeLedgerEntries (unit-tested in ledger.test.ts).
 *
 * Money in (verified against real columns — see the cited migrations):
 * - unified ledger income rows                   (0035 + 0461)
 * - sponsor_contributions type='cash'            (0035; no status column —
 *   recorded cash is treated as received, matching compute-season-finance.ts)
 * - fundraiser_events proceeds                   (0070_fundraiser_events.sql)
 * - finance_funding_sources received_usd         (0434_season_finance_desk.sql)
 * - grant_applications status='awarded'          (0036_grants_awards_outreach.sql)
 *
 * Money out:
 * - unified ledger expense rows — committed orders, receipts, paid season
 *   costs, manual expenses                       (0035 + 0461)
 * - purchase_requests / finance_purchase_log / season_costs fallbacks for
 *   rows not yet mirrored into the ledger        (0035 / 0434 / 0070)
 *
 * Double-count guards (each dollar counted once):
 * - Ledger income rows mirroring a sponsor contribution or fundraiser are
 *   skipped — those dollars are counted from sponsor_contributions /
 *   fundraiser_events.
 * - ONE SOURCE OF TRUTH PER FUNDING KIND (0504): a funding-desk line of kind
 *   grant / sponsor / fundraiser is a PLAN, not a second receipt. Its received
 *   dollars are counted from grant_applications / sponsor_contributions /
 *   fundraiser_events respectively and excluded here, so a treasurer who logs
 *   the same sponsor check on both surfaces never sees it twice. The same rule
 *   lives in compute-season-finance.ts (SATELLITE_FUNDING_KINDS).
 * - Legacy-table rows already mirrored into the ledger are excluded from the
 *   fallback unions (the 0461 dedup rule).
 * - BOM rows carry counts_in_balance=false — estimates are never cash.
 * - TRANSITIONAL (remove with the legacy unions): a ledger mirror row only
 *   counts while its source row still qualifies, because a not-yet-repointed
 *   writer can reject an order or delete a receipt without touching the
 *   ledger. Repointed writers already remove the mirror in-transaction.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  dedupeLedgerEntries,
  rollupLedgerByCategory,
  splitLedgerComponents,
  isMoneySource,
  type MoneyDirection,
  type UnifiedLedgerEntry,
} from "./ledger";

export type { UnifiedLedgerEntry } from "./ledger";
export { MONEY_SOURCE_LABELS } from "./ledger";

export type BalanceDirection = MoneyDirection;

export type BalanceActivityRow = {
  date: string;
  label: string;
  amountUsd: number;
  direction: BalanceDirection;
};

export type BalanceCategoryRow = {
  categoryId: string | null;
  name: string;
  inUsd: number;
  outUsd: number;
};

export type FinanceBalanceComponents = {
  ledgerInUsd: number;
  sponsorCashUsd: number;
  fundraiserProceedsUsd: number;
  fundingReceivedUsd: number;
  grantAwardedUsd: number;
  ledgerOutUsd: number;
  /** Committed /orders rows NOT yet mirrored into the unified ledger. */
  purchaseRequestsUsd: number;
  /** Business-desk receipts NOT yet mirrored into the unified ledger. */
  purchaseLogUsd: number;
  /** Paid season costs NOT yet mirrored into the unified ledger. */
  seasonCostsPaidUsd: number;
};

export type FinanceBalanceView =
  | { status: "setup_required"; message: string; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      totalInUsd: number;
      totalOutUsd: number;
      balanceUsd: number;
      byCategory: BalanceCategoryRow[];
      recentActivity: BalanceActivityRow[];
      /** The single chronological money ledger (deduped, newest first). */
      ledger: UnifiedLedgerEntry[];
      hasData: boolean;
      computedAt: string;
    };

/** Parse a numeric(12,2)::text (or number) into whole-cent-accurate USD. */
export function toUsd(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function sumBalanceComponents(components: FinanceBalanceComponents): {
  totalInUsd: number;
  totalOutUsd: number;
  balanceUsd: number;
} {
  const totalInCents = Math.round(
    (components.ledgerInUsd +
      components.sponsorCashUsd +
      components.fundraiserProceedsUsd +
      components.fundingReceivedUsd +
      components.grantAwardedUsd) *
      100,
  );
  const totalOutCents = Math.round(
    (components.ledgerOutUsd +
      components.purchaseRequestsUsd +
      components.purchaseLogUsd +
      components.seasonCostsPaidUsd) *
      100,
  );
  return {
    totalInUsd: totalInCents / 100,
    totalOutUsd: totalOutCents / 100,
    balanceUsd: (totalInCents - totalOutCents) / 100,
  };
}

/** Defensive newest-first sort + cap; SQL already orders and limits. */
export function normalizeActivity(rows: BalanceActivityRow[], limit = 10): BalanceActivityRow[] {
  return rows
    .filter((row) => row.amountUsd > 0 && (row.direction === "in" || row.direction === "out"))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

export function assembleFinanceBalance(input: {
  orgId: string;
  components: FinanceBalanceComponents;
  byCategory: BalanceCategoryRow[];
  recentActivity: BalanceActivityRow[];
  ledger?: UnifiedLedgerEntry[];
  now?: Date;
}): Extract<FinanceBalanceView, { status: "live" }> {
  const totals = sumBalanceComponents(input.components);
  const recentActivity = normalizeActivity(input.recentActivity);
  return {
    status: "live",
    orgId: input.orgId,
    ...totals,
    byCategory: input.byCategory,
    recentActivity,
    ledger: input.ledger ?? [],
    hasData: totals.totalInUsd > 0 || totals.totalOutUsd > 0 || recentActivity.length > 0,
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}

function isMissingRelationOrColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  // 42P01 undefined_table (finance tables absent), 42703 undefined_column
  // (0461_money_unify.sql not applied yet) — both mean "run migrations".
  return code === "42P01" || code === "42703";
}

/**
 * One SQL pass over the unified money ledger plus the legacy fallbacks.
 *
 * The `ledger` half applies the transitional source-still-qualifies guards; the
 * `fallback` half excludes anything already mirrored (the 0461 dedup rule).
 * The LIMIT is a runaway guard only — a team's money rows number in the
 * hundreds, and the newest-first cap would drop oldest rows first.
 */
const UNIFIED_LEDGER_SQL = `
  WITH ledger AS (
    SELECT t.id::text AS id,
           t.occurred_at::text AS date,
           COALESCE(NULLIF(t.description, ''), initcap(replace(t.source_kind, '_', ' '))) AS label,
           t.amount_usd::text AS "amountUsd",
           CASE WHEN t.type = 'income' THEN 'in' ELSE 'out' END AS direction,
           CASE WHEN t.purchase_request_id IS NOT NULL THEN 'purchase_request' ELSE t.source_kind END AS source,
           COALESCE(t.source_id, t.purchase_request_id)::text AS "sourceId",
           t.category_id::text AS "categoryId",
           c.name AS "categoryName",
           true AS mirrored
    FROM finance_transactions t
    LEFT JOIN finance_categories c ON c.id = t.category_id AND c.org_id = t.org_id
    WHERE t.org_id = $1::uuid
      AND t.counts_in_balance
      AND t.amount_usd > 0
      AND NOT (t.type = 'income' AND (t.source_kind IN ('sponsor_contribution', 'fundraiser')
                                      OR t.sponsor_contribution_id IS NOT NULL
                                      OR t.source = 'fundraiser'))
      AND ((t.source_kind <> 'purchase_request' AND t.purchase_request_id IS NULL)
           OR EXISTS (SELECT 1 FROM purchase_requests p
                      WHERE p.org_id = t.org_id
                        AND p.id = COALESCE(t.source_id, t.purchase_request_id)
                        AND p.status IN ('approved', 'ordered', 'received', 'reimbursed')))
      AND (t.source_kind <> 'purchase_log'
           OR EXISTS (SELECT 1 FROM finance_purchase_log l
                      WHERE l.org_id = t.org_id AND l.id = t.source_id))
      AND (t.source_kind <> 'season_cost'
           OR EXISTS (SELECT 1 FROM season_costs sc
                      WHERE sc.org_id = t.org_id AND sc.id = t.source_id AND sc.status = 'paid'))
  ), fallback AS (
    SELECT p.id::text AS id,
           COALESCE(p.ordered_at, p.reviewed_at, p.updated_at)::text AS date,
           'Order — ' || p.title AS label,
           p.total_cost_usd::text AS "amountUsd",
           'out' AS direction,
           'purchase_request' AS source,
           p.id::text AS "sourceId",
           p.category_id::text AS "categoryId",
           c.name AS "categoryName",
           false AS mirrored
    FROM purchase_requests p
    LEFT JOIN finance_categories c ON c.id = p.category_id AND c.org_id = p.org_id
    WHERE p.org_id = $1::uuid
      AND p.status IN ('approved', 'ordered', 'received', 'reimbursed')
      AND p.total_cost_usd > 0
      AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                      WHERE t.org_id = p.org_id
                        AND (t.purchase_request_id = p.id
                             OR (t.source_kind = 'purchase_request' AND t.source_id = p.id)))
    UNION ALL
    SELECT l.id::text,
           l.purchased_on::timestamptz::text,
           l.vendor || ' — ' || l.item,
           l.amount_usd::text,
           'out',
           'purchase_log',
           l.id::text,
           l.category_id::text,
           c.name,
           false
    FROM finance_purchase_log l
    LEFT JOIN finance_categories c ON c.id = l.category_id AND c.org_id = l.org_id
    WHERE l.org_id = $1::uuid
      AND l.amount_usd > 0
      AND l.purchase_request_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                      WHERE t.org_id = l.org_id
                        AND t.source_kind = 'purchase_log' AND t.source_id = l.id)
    UNION ALL
    SELECT sc.id::text,
           sc.incurred_on::timestamptz::text,
           'Season cost — ' || sc.label,
           sc.amount_usd::text,
           'out',
           'season_cost',
           sc.id::text,
           NULL::text,
           NULL::text,
           false
    FROM season_costs sc
    WHERE sc.org_id = $1::uuid
      AND sc.status = 'paid'
      AND sc.amount_usd > 0
      AND NOT EXISTS (SELECT 1 FROM finance_transactions t
                      WHERE t.org_id = sc.org_id
                        AND t.source_kind = 'season_cost' AND t.source_id = sc.id)
  )
  SELECT * FROM (SELECT * FROM ledger UNION ALL SELECT * FROM fallback) unified
  ORDER BY date DESC
  LIMIT 5000`;

type UnifiedLedgerRow = {
  id: string;
  date: string;
  label: string;
  amountUsd: string;
  direction: BalanceDirection;
  source: string;
  sourceId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  mirrored: boolean;
};

function mapLedgerRow(row: UnifiedLedgerRow): UnifiedLedgerEntry {
  return {
    id: row.id,
    date: row.date,
    label: row.label,
    amountUsd: toUsd(row.amountUsd),
    direction: row.direction === "in" ? "in" : "out",
    source: isMoneySource(row.source) ? row.source : "other",
    sourceId: row.sourceId,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    mirrored: Boolean(row.mirrored),
  };
}

export async function computeFinanceBalance(
  client: PoolClient,
  orgId: string,
): Promise<FinanceBalanceView> {
  try {
    const [unified, sponsor, fundraiser, funding, grants, incomeActivity] = await Promise.all([
      client.query<UnifiedLedgerRow>(UNIFIED_LEDGER_SQL, [orgId]),
      // No status column exists on sponsor_contributions (0035): recorded
      // cash amounts are treated as received (received_at defaults to now()).
      client.query<{ sponsorCashUsd: string }>(
        `SELECT COALESCE(SUM(amount_usd) FILTER (WHERE type = 'cash'), 0)::text AS "sponsorCashUsd"
         FROM sponsor_contributions
         WHERE org_id = $1::uuid`,
        [orgId],
      ),
      client.query<{ proceedsUsd: string }>(
        `SELECT COALESCE(SUM(proceeds_usd), 0)::text AS "proceedsUsd"
         FROM fundraiser_events
         WHERE org_id = $1::uuid AND status <> 'cancelled'`,
        [orgId],
      ),
      client.query<{ receivedUsd: string }>(
        `SELECT COALESCE(SUM(received_usd), 0)::text AS "receivedUsd"
         FROM finance_funding_sources
         WHERE org_id = $1::uuid
           AND kind NOT IN ('grant', 'sponsor', 'fundraiser')`,
        [orgId],
      ),
      client.query<{ awardedUsd: string }>(
        `SELECT COALESCE(SUM(amount_awarded_usd), 0)::text AS "awardedUsd"
         FROM grant_applications
         WHERE org_id = $1::uuid AND status = 'awarded'`,
        [orgId],
      ),
      // Income recorded outside the unified spine, for the activity feed only
      // (their totals come from the aggregate queries above).
      client.query<{ date: string; label: string; amountUsd: string; direction: BalanceDirection }>(
        `WITH activity AS (
           SELECT sc.received_at AS happened_at, 'Sponsor cash — ' || s.name AS label, sc.amount_usd, 'in' AS direction
           FROM sponsor_contributions sc
           JOIN sponsors s ON s.id = sc.sponsor_id
           WHERE sc.org_id = $1::uuid AND sc.type = 'cash' AND COALESCE(sc.amount_usd, 0) > 0
           UNION ALL
           SELECT event_date::timestamptz, 'Fundraiser — ' || name, proceeds_usd, 'in'
           FROM fundraiser_events
           WHERE org_id = $1::uuid AND status <> 'cancelled' AND proceeds_usd > 0
           UNION ALL
           SELECT COALESCE(received_on::timestamptz, updated_at), 'Funding — ' || name, received_usd, 'in'
           FROM finance_funding_sources
           WHERE org_id = $1::uuid AND received_usd > 0
             AND kind NOT IN ('grant', 'sponsor', 'fundraiser')
           UNION ALL
           SELECT COALESCE(decision_at, updated_at), 'Grant awarded', amount_awarded_usd, 'in'
           FROM grant_applications
           WHERE org_id = $1::uuid AND status = 'awarded' AND COALESCE(amount_awarded_usd, 0) > 0
         )
         SELECT happened_at::text AS "date", label, amount_usd::text AS "amountUsd", direction
         FROM activity
         ORDER BY happened_at DESC
         LIMIT 10`,
        [orgId],
      ),
    ]);

    // SQL already deduplicated via NOT EXISTS; this pure pass re-asserts the
    // rule so a mirrored + unmirrored mix can never double count.
    const ledger = dedupeLedgerEntries(unified.rows.map(mapLedgerRow));
    const split = splitLedgerComponents(ledger);

    return assembleFinanceBalance({
      orgId,
      components: {
        ...split,
        sponsorCashUsd: toUsd(sponsor.rows[0]?.sponsorCashUsd),
        fundraiserProceedsUsd: toUsd(fundraiser.rows[0]?.proceedsUsd),
        fundingReceivedUsd: toUsd(funding.rows[0]?.receivedUsd),
        grantAwardedUsd: toUsd(grants.rows[0]?.awardedUsd),
      },
      byCategory: rollupLedgerByCategory(ledger),
      recentActivity: normalizeActivity([
        ...ledger.map((entry) => ({
          date: entry.date,
          label: entry.label,
          amountUsd: entry.amountUsd,
          direction: entry.direction,
        })),
        ...incomeActivity.rows.map((row) => ({
          date: row.date,
          label: row.label,
          amountUsd: toUsd(row.amountUsd),
          direction: row.direction,
        })),
      ]),
      ledger,
    });
  } catch (error) {
    if (isMissingRelationOrColumn(error)) {
      return {
        status: "setup_required",
        message: "Finance tables are not up to date. Run database migrations, then reload.",
        orgId,
      };
    }
    throw error;
  }
}
