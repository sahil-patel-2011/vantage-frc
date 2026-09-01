/**
 * Real money balance — the team's actual cash position derived from recorded
 * finance_transactions rows only. There is deliberately NO denormalized
 * balance column anywhere: every number here is recomputed from the unified
 * ledger on read, under the caller's RLS context (org membership enforced by
 * row policies).
 *
 * Since 0461_money_unify.sql the UNIFIED LEDGER is the only cash read.
 * Legacy-table fallback unions are retired (P0-4): a source row that has not
 * been mirrored is skipped, not invented. Source writers call recordMoney()
 * in the same withRls transaction as their own write.
 *
 * Money in / out: finance_transactions rows with counts_in_balance and a
 * positive amount, whose source row still qualifies. BOM estimates
 * (counts_in_balance=false) are never cash.
 *
 * Double-count guards:
 * - One table, one row per (source_kind, source_id).
 * - TRANSITIONAL (remove once every writer is ledger-only): a mirror only
 *   counts while its source row still qualifies, because a not-yet-repointed
 *   writer can reject an order or delete a receipt without touching the ledger.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { hasRealLedgerData, keepRealLedgerEntries } from "./honesty";
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
  /** Retired fallback field — never enters totals. */
  sponsorCashUsd: number;
  /** Retired fallback field — never enters totals. */
  fundraiserProceedsUsd: number;
  /** Retired fallback field — never enters totals. */
  fundingReceivedUsd: number;
  /** Retired fallback field — never enters totals. */
  grantAwardedUsd: number;
  ledgerOutUsd: number;
  /** Retired fallback field — never enters totals. */
  purchaseRequestsUsd: number;
  /** Retired fallback field — never enters totals. */
  purchaseLogUsd: number;
  /** Retired fallback field — never enters totals. */
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

/**
 * Ledger in/out only. Leftover fallback component fields are accepted so
 * callers compile, but they never invent cash.
 */
export function sumBalanceComponents(components: FinanceBalanceComponents): {
  totalInUsd: number;
  totalOutUsd: number;
  balanceUsd: number;
} {
  const totalInCents = Math.round(components.ledgerInUsd * 100);
  const totalOutCents = Math.round(components.ledgerOutUsd * 100);
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
  const ledger = keepRealLedgerEntries(input.ledger ?? []);
  const totals = sumBalanceComponents(input.components);
  const recentActivity = normalizeActivity(input.recentActivity);
  return {
    status: "live",
    orgId: input.orgId,
    ...totals,
    byCategory: input.byCategory,
    recentActivity,
    ledger,
    hasData: hasRealLedgerData(ledger) || totals.totalInUsd > 0 || totals.totalOutUsd > 0,
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
 * One SQL pass over finance_transactions. No legacy-table UNION. The LIMIT
 * is a runaway guard only — a team's money rows number in the hundreds, and
 * the newest-first cap would drop oldest rows first.
 */
export const UNIFIED_LEDGER_SQL = `
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
    AND (t.source_kind <> 'sponsor_contribution'
         OR EXISTS (SELECT 1 FROM sponsor_contributions sc
                    WHERE sc.org_id = t.org_id AND sc.id = t.source_id
                      AND sc.type = 'cash' AND COALESCE(sc.amount_usd, 0) > 0))
    AND (t.source_kind <> 'fundraiser'
         OR EXISTS (SELECT 1 FROM fundraiser_events fe
                    WHERE fe.org_id = t.org_id AND fe.id = t.source_id
                      AND fe.status <> 'cancelled' AND fe.proceeds_usd > 0))
    AND (t.source_kind <> 'other' OR t.source_id IS NULL
         OR EXISTS (SELECT 1 FROM finance_funding_sources fs
                    WHERE fs.org_id = t.org_id AND fs.id = t.source_id
                      AND fs.kind <> 'in_kind' AND fs.received_usd > 0)
         OR EXISTS (SELECT 1 FROM grant_applications ga
                    WHERE ga.org_id = t.org_id AND ga.id = t.source_id
                      AND ga.status = 'awarded' AND COALESCE(ga.amount_awarded_usd, 0) > 0))
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
    const unified = await client.query<UnifiedLedgerRow>(UNIFIED_LEDGER_SQL, [orgId]);

    const ledger = keepRealLedgerEntries(dedupeLedgerEntries(unified.rows.map(mapLedgerRow)));
    const split = splitLedgerComponents(ledger);

    return assembleFinanceBalance({
      orgId,
      components: {
        ...split,
        sponsorCashUsd: 0,
        fundraiserProceedsUsd: 0,
        fundingReceivedUsd: 0,
        grantAwardedUsd: 0,
      },
      byCategory: rollupLedgerByCategory(ledger),
      recentActivity: normalizeActivity(
        ledger.map((entry) => ({
          date: entry.date,
          label: entry.label,
          amountUsd: entry.amountUsd,
          direction: entry.direction,
        })),
      ),
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
