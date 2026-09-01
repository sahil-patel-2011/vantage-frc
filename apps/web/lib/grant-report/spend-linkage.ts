import { summarizeSpend, type SpendTxnRow } from ".";
import type { GrantReportSpendLine } from "./types";

export const GRANT_FINANCE_ALLOCATIONS_TABLE = "grant_finance_allocations";

/** A ledger row that may or may not be tagged to a grant application. */
export type GrantTaggedTxn = {
  grantApplicationId: string | null;
  amountUsd: number;
  category: string;
};

export type GrantSpendAttribution = {
  spendAttribution: "explicit" | "setup_required";
  totalSpendUsd: number;
  spendByCategory: GrantReportSpendLine[];
};

export const EMPTY_GRANT_SPEND: GrantSpendAttribution = {
  spendAttribution: "setup_required",
  totalSpendUsd: 0,
  spendByCategory: [],
};

/** Keep only rows explicitly tagged to this grant. Untagged and other-grant rows drop. */
export function grantLinkedTransactions(
  rows: GrantTaggedTxn[],
  grantApplicationId: string,
): SpendTxnRow[] {
  return rows
    .filter((row) => row.grantApplicationId === grantApplicationId)
    .filter((row) => Number.isFinite(row.amountUsd) && row.amountUsd > 0)
    .map((row) => ({
      category: (row.category ?? "").trim() || "Uncategorized",
      amountUsd: Math.round(row.amountUsd * 100) / 100,
    }));
}

/**
 * Attribute spend to a grant. Missing linkage schema → setup_required and $0,
 * even when season-wide expenses are supplied. Never sums untagged totals.
 */
export function computeGrantSpendAttribution(input: {
  grantApplicationId: string;
  schemaAvailable: boolean;
  transactions: GrantTaggedTxn[];
}): GrantSpendAttribution {
  if (!input.schemaAvailable) {
    return { ...EMPTY_GRANT_SPEND, spendByCategory: [] };
  }
  const spendByCategory = summarizeSpend(
    grantLinkedTransactions(input.transactions, input.grantApplicationId),
  );
  const totalSpendUsd = Math.round(
    spendByCategory.reduce((sum, line) => sum + line.totalUsd, 0) * 100,
  ) / 100;
  return {
    spendAttribution: "explicit",
    totalSpendUsd,
    spendByCategory,
  };
}
