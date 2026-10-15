"use client";

// Money tab reads that only need the team and season, so they can start alongside the season
// view (season-finance-client) instead of after it.
import type { FinanceBalanceView } from "../../lib/finance/balance";
import type { BudgetLine, BudgetVsActualView } from "../../lib/finance/budget-vs-actual";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { sponsorPageTotals } from "../../lib/sponsors/totals";

export type SponsorLine = { id: string; name: string; amountUsd: number };

/**
 * Per-sponsor amounts and budget-vs-actual only need the team and season, so they start with
 * the season view instead of after it (they used to wait for /api/business/finance).
 */
export async function loadMoneyExtras(
  orgId: string,
  seasonYear: number,
): Promise<{ sponsorLines: SponsorLine[]; budgetLines: BudgetLine[] }> {
  try {
    const [sponsorsRes, contribRes, budgetRes] = await Promise.all([
      fetch(`/api/sponsors?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      }),
      fetch(
        `/api/sponsors/contributions?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      ),
      fetch(
        `/api/finance/budget-vs-actual?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      ),
    ]);
    const sponsorsData = sponsorsRes.ok ? await sponsorsRes.json() : { sponsors: [] };
    const contribData = contribRes.ok ? await contribRes.json() : { contributions: [] };
    const sponsors = Array.isArray(sponsorsData.sponsors) ? sponsorsData.sponsors : [];
    const contributions = Array.isArray(contribData.contributions) ? contribData.contributions : [];
    const totals = sponsorPageTotals(sponsors, contributions, true);
    const sponsorLines: SponsorLine[] = sponsors
      .map((row: { id?: string; name?: string }) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? "").trim() || String(row.id ?? ""),
        amountUsd: totals.amountBySponsorId[String(row.id ?? "")] ?? 0,
      }))
      .filter((row: { id: string }) => row.id)
      .sort((a: { amountUsd: number }, b: { amountUsd: number }) => b.amountUsd - a.amountUsd);
    const budgetData = (budgetRes.ok ? await budgetRes.json() : null) as BudgetVsActualView | null;
    return { sponsorLines, budgetLines: budgetData?.status === "ready" ? budgetData.lines : [] };
  } catch {
    return { sponsorLines: [], budgetLines: [] };
  }
}

export type BalanceRead = { orgId: string; data: FinanceBalanceView | null };

export async function readBalance(orgId: string): Promise<FinanceBalanceView | null> {
  const response = await fetch(`/api/finance/balance?${new URLSearchParams({ orgId }).toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
  });
  const data = (await response.json()) as FinanceBalanceView | { error?: string };
  return response.ok && "status" in data ? data : null;
}
