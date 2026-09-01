/**
 * /api/finance/summary honesty — season cash is one ledger number.
 *
 * Sponsor cash is already mirrored onto finance_transactions. Summing
 * sponsor_contributions here would double-count those dollars. Per-sponsor
 * amounts stay on /team/sponsors.
 *
 * Empty books close at $0 with empty=true. That is the absence of a ledger,
 * not a DEMO fill.
 */

import { summarizeMonthlyBudget } from "../finance";
import { isRealCashAmount } from "./honesty";

export type FinanceSummaryLedgerTxn = {
  type: "income" | "expense";
  amountUsd: number;
  occurredAt: string;
};

export type HonestFinanceSummary = ReturnType<typeof summarizeMonthlyBudget> & {
  /** True when the ledger has no real cash rows — totals are 0, never DEMO. */
  empty: boolean;
  /**
   * Always 0 on this surface. Season cash is `net` / `totalIncome` from the
   * ledger. A leftover sponsor_contributions sum is discarded.
   */
  sponsorCashUsd: 0;
};

function asLedgerTxn(row: {
  type?: unknown;
  amountUsd?: unknown;
  occurredAt?: unknown;
}): FinanceSummaryLedgerTxn | null {
  if (row.type !== "income" && row.type !== "expense") return null;
  const amountUsd = typeof row.amountUsd === "number" ? row.amountUsd : Number(row.amountUsd);
  if (!Number.isFinite(amountUsd)) return null;
  const occurredAt = typeof row.occurredAt === "string" ? row.occurredAt : "";
  if (!occurredAt) return null;
  return { type: row.type, amountUsd, occurredAt };
}

/** Ledger rows the treasurer can sum. Garbage / missing dates are dropped. */
export function ledgerTransactionsForSummary(
  rows: readonly { type?: unknown; amountUsd?: unknown; occurredAt?: unknown }[],
): FinanceSummaryLedgerTxn[] {
  return rows.flatMap((row) => {
    const txn = asLedgerTxn(row);
    return txn ? [txn] : [];
  });
}

export function isEmptyFinanceBooks(transactions: readonly FinanceSummaryLedgerTxn[]): boolean {
  return !transactions.some((txn) => isRealCashAmount(txn.amountUsd));
}

/**
 * Assemble season cash from finance_transactions only. `sponsorCashUsd` on
 * the input is ignored so a separate sponsor_contributions sum cannot be
 * added on top of mirrored ledger income.
 */
export function assembleHonestFinanceSummary(input: {
  transactions: readonly { type?: unknown; amountUsd?: unknown; occurredAt?: unknown }[];
  monthlyLimitUsd?: number | null;
  totalLimitUsd?: number | null;
  /** Discarded — mirrored sponsor cash already lives on the ledger. */
  sponsorCashUsd?: number;
}): HonestFinanceSummary {
  const transactions = ledgerTransactionsForSummary(input.transactions);
  const empty = isEmptyFinanceBooks(transactions);
  const summary = summarizeMonthlyBudget({
    transactions: empty ? [] : transactions,
    monthlyLimitUsd: input.monthlyLimitUsd,
    totalLimitUsd: input.totalLimitUsd,
  });
  return {
    ...summary,
    empty,
    sponsorCashUsd: 0,
  };
}
