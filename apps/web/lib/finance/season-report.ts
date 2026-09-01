/**
 * SEASON FINANCIAL REPORT — the treasurer's handoff document.
 *
 * Every March a parent hands the books to the next parent. What they need is
 * one file: every dollar in and out, oldest first, with a running balance that
 * ends on the number the app shows today. That is the entire spec.
 *
 * computeFinanceBalance() supplies the unified ledger only. Rows without a
 * finance_transactions mirror are skipped — this module does not re-read
 * sponsor, fundraiser, funding, or grant tables.
 *
 * The invariant this module exists to hold: when there are real rows, the LAST
 * row's running balance equals the balance view's balanceUsd. Empty books close
 * at $0 but that is not a successful tie-out (isHonestTieOut).
 *
 * NEVER FABRICATED: nothing is estimated, prorated, or filled in. Rows without a
 * category export an empty category cell rather than a guess, and BOM estimates
 * (counts_in_balance = false) are absent because they were never cash.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { CsvColumn } from "../export/to-csv";
import {
  loadMediaEvidenceReferences,
  type MediaEvidenceReference,
} from "../media/evidence-references";
import { computeFinanceBalance, type FinanceBalanceView } from "./balance";
import { isHonestTieOut, keepRealLedgerEntries } from "./honesty";
import { MONEY_SOURCE_LABELS, type MoneySource, type UnifiedLedgerEntry } from "./ledger";

export type SeasonReportRow = {
  /** ISO date of the movement. */
  date: string;
  label: string;
  source: MoneySource;
  sourceLabel: string;
  category: string;
  direction: "in" | "out";
  /** Positive dollars in, else 0 — spreadsheet-friendly two-column form. */
  inUsd: number;
  outUsd: number;
  /** Cumulative balance after this row, oldest-first. */
  runningBalanceUsd: number;
};

/**
 * Deterministic oldest-first order. Ties break on direction (money in before
 * money out on the same instant, so a same-day deposit-then-spend never dips
 * the running balance below what actually happened) then on label and id.
 */
function compareEntries(a: UnifiedLedgerEntry, b: UnifiedLedgerEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.direction !== b.direction) return a.direction === "in" ? -1 : 1;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure: real ledger entries -> report rows with a running balance. Cents
 * arithmetic throughout so a 400-row season cannot drift by a penny.
 * Unmirrored fallback rows and $0 amounts are skipped.
 */
export function buildSeasonReportRows(entries: readonly UnifiedLedgerEntry[]): SeasonReportRow[] {
  const usable = keepRealLedgerEntries(entries);
  const ordered = [...usable].sort(compareEntries);
  let runningCents = 0;
  return ordered.map((entry) => {
    const cents = Math.round(entry.amountUsd * 100);
    const isIn = entry.direction === "in";
    runningCents += isIn ? cents : -cents;
    return {
      date: entry.date,
      label: entry.label,
      source: entry.source,
      sourceLabel: MONEY_SOURCE_LABELS[entry.source] ?? "Other",
      category: entry.categoryName ?? "",
      direction: entry.direction,
      inUsd: isIn ? cents / 100 : 0,
      outUsd: isIn ? 0 : cents / 100,
      runningBalanceUsd: runningCents / 100,
    };
  });
}

/** Closing balance of a report — the number that must match the balance view. */
export function closingBalanceUsd(rows: readonly SeasonReportRow[]): number {
  return rows.length > 0 ? rows[rows.length - 1]!.runningBalanceUsd : 0;
}

/**
 * Columns for the shared toCsv(). Dates stay ISO, money stays unformatted —
 * the receiving spreadsheet does the formatting, not us.
 */
export const SEASON_REPORT_COLUMNS: readonly CsvColumn<SeasonReportRow>[] = [
  { key: "date", header: "Date", hint: "When the money moved (ISO-8601)" },
  { key: "label", header: "Description", hint: "What the entry is" },
  { key: "sourceLabel", header: "Source", hint: "Which part of Vantage recorded it" },
  { key: "category", header: "Category", hint: "Budget category, blank if uncategorized" },
  { key: "inUsd", header: "Money in (USD)", hint: "0 for expenses" },
  { key: "outUsd", header: "Money out (USD)", hint: "0 for income" },
  { key: "runningBalanceUsd", header: "Running balance (USD)", hint: "Cumulative balance after this row" },
];

export type SeasonReport =
  | { status: "setup_required"; message: string; orgId: string | null }
  | {
      status: "ready";
      orgId: string;
      rows: SeasonReportRow[];
      totalInUsd: number;
      totalOutUsd: number;
      balanceUsd: number;
      evidenceLibrary: MediaEvidenceReference[];
      /** True when real rows tie out to the balance view. Empty books are false. */
      reconciles: boolean;
      generatedAt: string;
    };

/**
 * Assemble the report. Returns the same setup_required shape balance.ts uses
 * when the finance tables are not migrated, so the endpoint degrades to a clear
 * "configure this" instead of a 500.
 */
export async function computeSeasonReport(
  client: PoolClient,
  orgId: string,
): Promise<SeasonReport> {
  const balance: FinanceBalanceView = await computeFinanceBalance(client, orgId);
  if (balance.status !== "live") {
    return { status: "setup_required", message: balance.message, orgId: balance.orgId };
  }

  const evidenceLibrary = await loadMediaEvidenceReferences(client, { orgId });
  const rows = buildSeasonReportRows(balance.ledger);
  const closing = closingBalanceUsd(rows);
  return {
    status: "ready",
    orgId,
    rows,
    totalInUsd: balance.totalInUsd,
    totalOutUsd: balance.totalOutUsd,
    balanceUsd: balance.balanceUsd,
    evidenceLibrary,
    reconciles: isHonestTieOut({
      closingUsd: closing,
      reportedBalanceUsd: balance.balanceUsd,
      rowCount: rows.length,
    }),
    generatedAt: new Date().toISOString(),
  };
}
