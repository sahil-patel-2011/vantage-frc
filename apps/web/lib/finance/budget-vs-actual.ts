/**
 * BUDGET vs ACTUAL — the question every treasurer-parent asks in February and
 * no surface could answer: "which category are we blowing through?"
 *
 * The budget side is finance_budget_plans (0035): a per-category total_limit_usd
 * an owner/admin set for the season. The actual side is the UNIFIED LEDGER from
 * 0461 — finance_transactions rows with counts_in_balance = true, which since
 * that migration already include orders, receipts, paid season costs, and (from
 * 0482) paid reimbursements. Joining the two is the whole feature.
 *
 * NEVER FABRICATED:
 *  - A category with no budget plan reports budgetUsd = null and state
 *    "no_budget". It does not get a made-up target, and it does not get a
 *    percentage. Spending is still shown, because the dollars are real.
 *  - Spending with no category lands in a single "Uncategorized" line that is
 *    labelled as such — it is never redistributed across the real categories.
 *  - Percentages are only computed against a budget greater than zero.
 *
 * Everything below the SQL constant is pure and unit-tested.
 */

import type { PoolClient } from "@neondatabase/serverless";

export type BudgetLineState =
  /** Budget set, spending comfortably inside it. */
  | "on_track"
  /** Budget set, 80–100% consumed. */
  | "close"
  /** Budget set, spending exceeds it. */
  | "over"
  /** Real spending, no budget to compare against. */
  | "no_budget"
  /** Budget set, nothing spent yet. */
  | "unused";

export type BudgetLine = {
  categoryId: string | null;
  name: string;
  /** null when no finance_budget_plans row exists for the category. */
  budgetUsd: number | null;
  spentUsd: number;
  /** Income booked against this category (grants earmarked to a bucket, refunds). */
  incomeUsd: number;
  /** budget - spent. Positive is money left. null without a budget. */
  remainingUsd: number | null;
  /** 0–n, where 1 means exactly at budget. null without a positive budget. */
  consumedRatio: number | null;
  state: BudgetLineState;
};

export type BudgetVsActualView =
  | { status: "setup_required"; message: string; orgId: string | null; seasonYear: number }
  | {
      status: "ready";
      orgId: string;
      seasonYear: number;
      lines: BudgetLine[];
      totals: {
        budgetedUsd: number;
        spentUsd: number;
        incomeUsd: number;
        remainingUsd: number;
        /** Categories with a budget that spending has already passed. */
        overCount: number;
        /** Real spend that no category owns. */
        uncategorizedUsd: number;
      };
      /** False when the org has neither budgets nor categorised spend yet. */
      hasData: boolean;
      computedAt: string;
    };

/** Percentage of budget at which a line stops reading "fine" and starts reading "watch it". */
export const BUDGET_CLOSE_RATIO = 0.8;

function cents(value: number): number {
  const n = Math.round(Number(value) * 100);
  return Number.isFinite(n) ? n : 0;
}

function usd(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export type BudgetVsActualInput = {
  categoryId: string | null;
  name: string;
  budgetUsd: number | null;
  spentUsd: number;
  incomeUsd: number;
};

/** Classify one category line. Pure — the whole point of this module. */
export function classifyBudgetLine(input: {
  budgetUsd: number | null;
  spentUsd: number;
}): { state: BudgetLineState; remainingUsd: number | null; consumedRatio: number | null } {
  const spentCents = cents(input.spentUsd);
  if (input.budgetUsd == null) {
    return { state: "no_budget", remainingUsd: null, consumedRatio: null };
  }
  const budgetCents = cents(input.budgetUsd);
  const remainingUsd = (budgetCents - spentCents) / 100;
  if (budgetCents <= 0) {
    // A zero budget is a real decision ("we spend nothing here"), so any spend
    // against it is over — but there is no meaningful ratio to divide by.
    return {
      state: spentCents > 0 ? "over" : "unused",
      remainingUsd,
      consumedRatio: null,
    };
  }
  const consumedRatio = spentCents / budgetCents;
  if (spentCents === 0) return { state: "unused", remainingUsd, consumedRatio: 0 };
  if (spentCents > budgetCents) return { state: "over", remainingUsd, consumedRatio };
  if (consumedRatio >= BUDGET_CLOSE_RATIO) return { state: "close", remainingUsd, consumedRatio };
  return { state: "on_track", remainingUsd, consumedRatio };
}

/**
 * Build the ordered lines + totals. Ordering puts what needs attention first:
 * over budget, then close to it, then everything else by spend.
 */
export function rollupBudgetVsActual(rows: readonly BudgetVsActualInput[]): {
  lines: BudgetLine[];
  totals: Extract<BudgetVsActualView, { status: "ready" }>["totals"];
  hasData: boolean;
} {
  const lines: BudgetLine[] = rows.map((row) => {
    const spentUsd = usd(row.spentUsd);
    const budgetUsd = row.budgetUsd == null ? null : usd(row.budgetUsd);
    const verdict = classifyBudgetLine({ budgetUsd, spentUsd });
    return {
      categoryId: row.categoryId,
      name: row.name,
      budgetUsd,
      spentUsd,
      incomeUsd: usd(row.incomeUsd),
      ...verdict,
    };
  });

  const rank: Record<BudgetLineState, number> = {
    over: 0,
    close: 1,
    on_track: 2,
    no_budget: 3,
    unused: 4,
  };
  lines.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      cents(b.spentUsd) - cents(a.spentUsd) ||
      a.name.localeCompare(b.name),
  );

  let budgetedCents = 0;
  let spentCents = 0;
  let incomeCents = 0;
  let overCount = 0;
  let uncategorizedCents = 0;
  for (const line of lines) {
    if (line.budgetUsd != null) budgetedCents += cents(line.budgetUsd);
    spentCents += cents(line.spentUsd);
    incomeCents += cents(line.incomeUsd);
    if (line.state === "over") overCount += 1;
    if (line.categoryId === null) uncategorizedCents += cents(line.spentUsd);
  }

  return {
    lines,
    totals: {
      budgetedUsd: budgetedCents / 100,
      spentUsd: spentCents / 100,
      incomeUsd: incomeCents / 100,
      remainingUsd: (budgetedCents - spentCents) / 100,
      overCount,
      uncategorizedUsd: uncategorizedCents / 100,
    },
    hasData: budgetedCents > 0 || spentCents > 0 || incomeCents > 0,
  };
}

/** Plain-language line the panel shows under each bar. Never a fabricated number. */
export function describeBudgetLine(line: BudgetLine): string {
  const money = (value: number) =>
    value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  switch (line.state) {
    case "no_budget":
      return `${money(line.spentUsd)} spent — no budget set for this category yet.`;
    case "unused":
      return `${money(line.budgetUsd ?? 0)} budgeted, nothing spent yet.`;
    case "over":
      return `${money(line.spentUsd)} of ${money(line.budgetUsd ?? 0)} — over by ${money(Math.abs(line.remainingUsd ?? 0))}.`;
    case "close":
      return `${money(line.spentUsd)} of ${money(line.budgetUsd ?? 0)} — ${money(line.remainingUsd ?? 0)} left.`;
    default:
      return `${money(line.spentUsd)} of ${money(line.budgetUsd ?? 0)} — ${money(line.remainingUsd ?? 0)} left.`;
  }
}

// ---------------------------------------------------------------- data access

/**
 * One pass: every season category with its plan and its ledger actuals, plus a
 * separate uncategorised bucket. counts_in_balance filters out BOM estimates
 * (0461), so a planning number can never masquerade as spend.
 */
export const BUDGET_VS_ACTUAL_SQL = `
  WITH actuals AS (
    SELECT t.category_id,
           COALESCE(SUM(t.amount_usd) FILTER (WHERE t.type = 'expense'), 0) AS spent_usd,
           COALESCE(SUM(t.amount_usd) FILTER (WHERE t.type = 'income'), 0) AS income_usd
    FROM finance_transactions t
    WHERE t.org_id = $1::uuid
      AND t.season_year = $2::int
      AND t.counts_in_balance
      AND t.amount_usd > 0
    GROUP BY t.category_id
  )
  SELECT c.id::text AS "categoryId",
         c.name,
         p.total_limit_usd::text AS "budgetUsd",
         COALESCE(a.spent_usd, 0)::text AS "spentUsd",
         COALESCE(a.income_usd, 0)::text AS "incomeUsd"
  FROM finance_categories c
  LEFT JOIN finance_budget_plans p ON p.category_id = c.id AND p.org_id = c.org_id
  LEFT JOIN actuals a ON a.category_id = c.id
  WHERE c.org_id = $1::uuid AND c.season_year = $2::int
  UNION ALL
  SELECT NULL,
         'Uncategorized',
         NULL,
         a.spent_usd::text,
         a.income_usd::text
  FROM actuals a
  WHERE a.category_id IS NULL
  LIMIT 500`;

type BudgetRow = {
  categoryId: string | null;
  name: string;
  budgetUsd: string | null;
  spentUsd: string;
  incomeUsd: string;
};

export async function computeBudgetVsActual(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<BudgetVsActualView> {
  try {
    const result = await client.query<BudgetRow>(BUDGET_VS_ACTUAL_SQL, [orgId, seasonYear]);
    const { lines, totals, hasData } = rollupBudgetVsActual(
      result.rows.map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        budgetUsd: row.budgetUsd == null ? null : usd(row.budgetUsd),
        spentUsd: usd(row.spentUsd),
        incomeUsd: usd(row.incomeUsd),
      })),
    );
    return {
      status: "ready",
      orgId,
      seasonYear,
      lines,
      totals,
      hasData,
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { code: unknown }).code);
      if (code === "42P01" || code === "42703") {
        return {
          status: "setup_required",
          message: "Finance tables are not up to date. Run database migrations, then reload.",
          orgId,
          seasonYear,
        };
      }
    }
    throw error;
  }
}
