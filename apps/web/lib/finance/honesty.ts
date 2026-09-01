/**
 * Finance honesty gate — cash totals come only from real finance_transactions
 * rows. Legacy-table fallbacks, DEMO fills, and a $0 close with no rows are
 * not success. Balance and the season report share these predicates so they
 * cannot drift into inventing money.
 */

import type { UnifiedLedgerEntry } from "./ledger";

export type LedgerHonestyRow = Pick<UnifiedLedgerEntry, "mirrored" | "amountUsd">;

/** Whole-cent cash that actually moved. $0 / null / garbage is not progress. */
export function isRealCashAmount(value: number | string | null | undefined): boolean {
  if (value == null || value === "") return false;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return false;
  return Math.round(amount * 100) > 0;
}

/**
 * A row the treasurer can trust: it is a finance_transactions mirror and the
 * dollars are real. Unmirrored legacy fallbacks are skipped, not summed.
 */
export function isRealLedgerEntry(entry: LedgerHonestyRow): boolean {
  return entry.mirrored === true && isRealCashAmount(entry.amountUsd);
}

export function keepRealLedgerEntries<T extends LedgerHonestyRow>(entries: readonly T[]): T[] {
  return entries.filter(isRealLedgerEntry);
}

export function hasRealLedgerData(entries: readonly LedgerHonestyRow[]): boolean {
  return entries.some(isRealLedgerEntry);
}

/**
 * A successful tie-out needs real rows. Empty books close at $0 — that is the
 * absence of a ledger, not a reconciled season.
 */
export function isHonestTieOut(input: {
  closingUsd: number;
  reportedBalanceUsd: number;
  rowCount: number;
}): boolean {
  if (input.rowCount <= 0) return false;
  if (!Number.isFinite(input.closingUsd) || !Number.isFinite(input.reportedBalanceUsd)) return false;
  return Math.round(input.closingUsd * 100) === Math.round(input.reportedBalanceUsd * 100);
}
