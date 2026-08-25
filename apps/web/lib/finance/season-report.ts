/**
 * SEASON FINANCIAL REPORT — the treasurer's handoff document.
 *
 * Every March a parent hands the books to the next parent. What they need is
 * one file: every dollar in and out, oldest first, with a running balance that
 * ends on the number the app shows today. That is the entire spec.
 *
 * The rows come from TWO places, and both are required for the running balance
 * to be trustworthy:
 *  1. computeFinanceBalance()'s unified ledger — every expense (orders,
 *     receipts, paid season costs, paid reimbursements, manual) plus manual
 *     income, already deduped against the legacy tables by the 0461 rule.
 *  2. Income recorded outside the ledger spine — sponsor cash, fundraiser
 *     proceeds, funding-desk receipts, awarded grants. balance.ts counts these
 *     in totalInUsd from their own tables but deliberately keeps them OUT of
 *     `ledger` (double-count guard). A report built from `ledger` alone would
 *     therefore show a running balance that never matches the app.
 *
 * The invariant this module exists to hold: the LAST row's running balance
 * equals the balance view's balanceUsd. It is asserted in season-report.test.ts.
 *
 * NEVER FABRICATED: nothing is estimated, prorated, or filled in. Rows without a
 * category export an empty category cell rather than a guess, and BOM estimates
 * (counts_in_balance = false) are absent because they were never cash.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { CsvColumn } from "../export/to-csv";
import { computeFinanceBalance, type FinanceBalanceView } from "./balance";
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
 * Pure: ledger entries -> report rows with a running balance. Cents arithmetic
 * throughout so a 400-row season cannot drift by a penny.
 */
export function buildSeasonReportRows(entries: readonly UnifiedLedgerEntry[]): SeasonReportRow[] {
  const usable = entries.filter((entry) => {
    const cents = Math.round(entry.amountUsd * 100);
    return Number.isFinite(cents) && cents > 0;
  });
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

// ---------------------------------------------------------------- data access

/**
 * Income recorded outside the unified spine. This is the SAME union
 * balance.ts uses for its activity feed, without the LIMIT 10 — the report
 * needs every row, not a preview. Kept in lockstep with the aggregate queries
 * in computeFinanceBalance so the totals and the rows describe one reality.
 */
export const EXTERNAL_INCOME_SQL = `
  WITH income AS (
    SELECT sc.id::text AS id,
           sc.received_at AS happened_at,
           'Sponsor cash — ' || s.name AS label,
           sc.amount_usd AS amount_usd,
           'sponsor_contribution' AS source
    FROM sponsor_contributions sc
    JOIN sponsors s ON s.id = sc.sponsor_id
    WHERE sc.org_id = $1::uuid AND sc.type = 'cash' AND COALESCE(sc.amount_usd, 0) > 0
    UNION ALL
    SELECT id::text, event_date::timestamptz, 'Fundraiser — ' || name, proceeds_usd, 'fundraiser'
    FROM fundraiser_events
    WHERE org_id = $1::uuid AND status <> 'cancelled' AND proceeds_usd > 0
    UNION ALL
    SELECT id::text, COALESCE(received_on::timestamptz, updated_at), 'Funding — ' || name, received_usd, 'other'
    FROM finance_funding_sources
    WHERE org_id = $1::uuid AND received_usd > 0
    UNION ALL
    SELECT id::text, COALESCE(decision_at, updated_at), 'Grant awarded', amount_awarded_usd, 'other'
    FROM grant_applications
    WHERE org_id = $1::uuid AND status = 'awarded' AND COALESCE(amount_awarded_usd, 0) > 0
  )
  SELECT id, happened_at::text AS "date", label, amount_usd::text AS "amountUsd", source
  FROM income
  ORDER BY happened_at
  LIMIT 5000`;

type ExternalIncomeRow = {
  id: string;
  date: string;
  label: string;
  amountUsd: string;
  source: string;
};

function toEntry(row: ExternalIncomeRow): UnifiedLedgerEntry {
  const amount = Number(row.amountUsd ?? 0);
  const source: MoneySource =
    row.source === "sponsor_contribution" || row.source === "fundraiser" ? row.source : "other";
  return {
    // Prefixed so an external income id can never collide with a ledger row id.
    id: `income:${row.id}`,
    date: row.date,
    label: row.label,
    amountUsd: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    direction: "in",
    source,
    // Deliberately null: these rows are NOT ledger mirrors, and giving them a
    // sourceId would invite dedupeLedgerEntries to merge them with one.
    sourceId: null,
    categoryId: null,
    categoryName: null,
    mirrored: false,
  };
}

export type SeasonReport =
  | { status: "setup_required"; message: string; orgId: string | null }
  | {
      status: "ready";
      orgId: string;
      rows: SeasonReportRow[];
      totalInUsd: number;
      totalOutUsd: number;
      balanceUsd: number;
      /** True when the running balance agrees with the balance view's total. */
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

  let external: UnifiedLedgerEntry[] = [];
  try {
    const result = await client.query<ExternalIncomeRow>(EXTERNAL_INCOME_SQL, [orgId]);
    external = result.rows.map(toEntry);
  } catch (error) {
    // A missing income table means that income source is not installed for this
    // deployment; the report is still honest, it just has fewer rows. Anything
    // else is a real failure and must surface.
    if (typeof error !== "object" || error === null || !("code" in error)) throw error;
    const code = String((error as { code: unknown }).code);
    if (code !== "42P01" && code !== "42703") throw error;
  }

  const rows = buildSeasonReportRows([...balance.ledger, ...external]);
  const closing = closingBalanceUsd(rows);
  return {
    status: "ready",
    orgId,
    rows,
    totalInUsd: balance.totalInUsd,
    totalOutUsd: balance.totalOutUsd,
    balanceUsd: balance.balanceUsd,
    // Reported, never silently corrected: if an income table went missing above,
    // the treasurer sees that the file does not tie out rather than trusting it.
    reconciles: Math.round(closing * 100) === Math.round(balance.balanceUsd * 100),
    generatedAt: new Date().toISOString(),
  };
}
