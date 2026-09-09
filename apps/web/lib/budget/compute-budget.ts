/**
 * THE MENTOR BUDGET — one number, and only real dollars against it.
 *
 * WHAT THIS REUSES (nothing about money is re-implemented here):
 *  - `season_budgets` (0070) is still the one place a season's total budget
 *    lives. 0621 narrowed its RLS from "any member" to the `manage_budget`
 *    capability, which is what makes it invisible to students — this module does
 *    not keep a second copy of the number.
 *  - `finance_transactions` with `counts_in_balance` (0461_money_unify) is the
 *    ONLY source of recorded spend. Orders, receipts, paid season costs and
 *    paid reimbursements already mirror onto it through
 *    apps/web/lib/finance/ledger.ts, so competition fees and ordered parts land
 *    in the same total with no new plumbing.
 *  - `season_costs` (0070) supplies the competition-fee breakout, and
 *    `addCost()` from lib/costs/compute-costs.ts writes one — including its
 *    ledger mirror — so a fee recorded here counts exactly once.
 *  - `purchase_requests` (0035/0171/0184) is the part-request queue.
 *
 * WHAT IT REFUSES TO DO:
 *  - No budget set => `remainingUsd` is null. Not zero, not the spend negated.
 *  - Budget set but NOTHING recorded => `remainingUsd` is STILL null, and the
 *    state is `budget_no_spend`. "$0 spent, 100% left" is a lie the data cannot
 *    support: an empty ledger means nobody has entered anything, which is not
 *    the same as nothing having been spent. Two flattering defaults have
 *    already shipped in this codebase; this is not the third.
 *  - BOM estimates (counts_in_balance = false) are never counted as spend.
 *
 * Pure functions below the SQL are unit-tested in compute-budget.test.ts.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { MONEY_SOURCE_LABELS, isMoneySource, type MoneySource } from "../finance/ledger";

export type BudgetState =
  /** No budget, nothing recorded. The team has not started. */
  | "no_budget_no_spend"
  /** Real recorded spend, but no budget to measure it against. */
  | "no_budget"
  /** A budget exists, but the ledger is empty — so nothing can be subtracted. */
  | "budget_no_spend"
  /** A budget and real spend. The only state with a remaining number. */
  | "tracking"
  /** Recorded spend already exceeds the budget. */
  | "over";

export type BudgetSummary = {
  totalBudgetUsd: number | null;
  recordedSpendUsd: number;
  /** Non-null ONLY in `tracking` / `over`. See the module comment. */
  remainingUsd: number | null;
  /** 0–n against a positive budget; null when there is nothing honest to divide. */
  consumedRatio: number | null;
  state: BudgetState;
};

export type BudgetSpendLine = {
  source: MoneySource;
  label: string;
  outUsd: number;
  rowCount: number;
};

export type CompetitionFeeLine = {
  status: "planned" | "paid";
  amountUsd: number;
  rowCount: number;
};

export type PartRequestRollup = {
  status: string;
  amountUsd: number;
  rowCount: number;
};

export type BudgetView =
  | {
      status: "setup_required";
      message: string;
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      /** How this person got in — shown verbatim so nobody assumes a mentor flag. */
      accessVia: "owner" | "admin" | "granted";
      budget: {
        totalBudgetUsd: number | null;
        notes: string | null;
        updatedAt: string | null;
      };
      summary: BudgetSummary;
      spendBySource: BudgetSpendLine[];
      competitionFees: CompetitionFeeLine[];
      /** Requests that have NOT been approved, so they are not spend. */
      openPartRequests: PartRequestRollup[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  // An FRC season is named for the year it competes in; kickoff is early January,
  // so the season year only rolls over at the calendar year.
  return now.getUTCFullYear();
}

function cents(value: number): number {
  const n = Math.round(Number(value) * 100);
  return Number.isFinite(n) ? n : 0;
}

export function usd(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

/**
 * The whole honesty policy, in one pure function.
 *
 * `recordedRowCount` is deliberately separate from `recordedSpendUsd`: a ledger
 * holding a single $0.00 row is "recorded", and a ledger holding nothing is
 * not. Only the second one is allowed to suppress the remaining number.
 */
export function summarizeBudget(input: {
  totalBudgetUsd: number | null;
  recordedSpendUsd: number;
  recordedRowCount: number;
}): BudgetSummary {
  const spentCents = cents(input.recordedSpendUsd);
  const recordedSpendUsd = spentCents / 100;
  const hasSpendRows = input.recordedRowCount > 0;

  if (input.totalBudgetUsd == null) {
    return {
      totalBudgetUsd: null,
      recordedSpendUsd,
      remainingUsd: null,
      consumedRatio: null,
      state: hasSpendRows ? "no_budget" : "no_budget_no_spend",
    };
  }

  const budgetCents = cents(input.totalBudgetUsd);

  if (!hasSpendRows) {
    return {
      totalBudgetUsd: budgetCents / 100,
      recordedSpendUsd,
      remainingUsd: null,
      consumedRatio: null,
      state: "budget_no_spend",
    };
  }

  const remainingUsd = (budgetCents - spentCents) / 100;
  return {
    totalBudgetUsd: budgetCents / 100,
    recordedSpendUsd,
    remainingUsd,
    consumedRatio: budgetCents > 0 ? spentCents / budgetCents : null,
    state: spentCents > budgetCents ? "over" : "tracking",
  };
}

/** The sentence the page prints under the headline. Never a fabricated number. */
export function describeBudget(summary: BudgetSummary): string {
  const money = (value: number) =>
    value.toLocaleString(undefined, { style: "currency", currency: "USD" });

  switch (summary.state) {
    case "no_budget_no_spend":
      return "No budget set, and no spending recorded yet. Set the season budget to start tracking.";
    case "no_budget":
      return `${money(summary.recordedSpendUsd)} of real spending is recorded, with no budget to measure it against.`;
    case "budget_no_spend":
      return (
        `${money(summary.totalBudgetUsd ?? 0)} budgeted. Nothing has been recorded against it yet, ` +
        "so there is no remaining figure — an empty ledger means nothing has been entered, not that nothing has been spent."
      );
    case "over":
      return `${money(summary.recordedSpendUsd)} recorded against ${money(summary.totalBudgetUsd ?? 0)} — over by ${money(Math.abs(summary.remainingUsd ?? 0))}.`;
    default:
      return `${money(summary.recordedSpendUsd)} recorded against ${money(summary.totalBudgetUsd ?? 0)} — ${money(summary.remainingUsd ?? 0)} left.`;
  }
}

// ---------------------------------------------------------------- data access

/** Recorded spend, by where the dollars came from. BOM estimates excluded. */
const SPEND_BY_SOURCE_SQL = `
  SELECT source_kind AS source,
         COALESCE(SUM(amount_usd) FILTER (WHERE type = 'expense'), 0)::text AS "outUsd",
         COUNT(*) FILTER (WHERE type = 'expense')::int AS "rowCount"
    FROM finance_transactions
   WHERE org_id = $1::uuid
     AND season_year = $2::int
     AND counts_in_balance
     AND amount_usd > 0
   GROUP BY source_kind
   -- On the SUM, not on the "outUsd" text cast: ordering that string puts
   -- $9.00 above $60.00.
   ORDER BY COALESCE(SUM(amount_usd) FILTER (WHERE type = 'expense'), 0) DESC
   LIMIT 50`;

/**
 * Competition fees, broken out of season_costs so a mentor can see them as a
 * line rather than hunting for them. PAID rows are already inside the ledger
 * total above (0461 mirrors them), so this is a breakout, never an addition —
 * adding it to `recordedSpendUsd` would double count.
 */
const COMPETITION_FEES_SQL = `
  SELECT status,
         COALESCE(SUM(amount_usd), 0)::text AS "amountUsd",
         COUNT(*)::int AS "rowCount"
    FROM season_costs
   WHERE org_id = $1::uuid
     AND season_year = $2::int
     AND category IN ('registration', 'event_fee')
   GROUP BY status`;

/**
 * Requests nobody has decided on yet. Deliberately NOT counted as spend:
 * approving one is what commits the money (lib/orders/compute-orders.ts
 * mirrors the approval onto the ledger), and a pending ask is not a dollar.
 */
const OPEN_PART_REQUESTS_SQL = `
  SELECT status::text AS status,
         COALESCE(SUM(total_cost_usd), 0)::text AS "amountUsd",
         COUNT(*)::int AS "rowCount"
    FROM purchase_requests
   WHERE org_id = $1::uuid
     AND season_year = $2::int
     AND status = 'pending'
   GROUP BY status`;

const SEASONS_SQL = `
  SELECT DISTINCT season_year AS "seasonYear" FROM (
    SELECT season_year FROM season_budgets WHERE org_id = $1::uuid
    UNION SELECT season_year FROM season_costs WHERE org_id = $1::uuid
    UNION SELECT season_year FROM purchase_requests WHERE org_id = $1::uuid
    UNION SELECT season_year FROM finance_transactions WHERE org_id = $1::uuid
  ) s
  ORDER BY season_year DESC
  LIMIT 20`;

function missingTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "42P01" || code === "42703" || code === "42883";
}

export async function computeBudgetView(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    accessVia: "owner" | "admin" | "granted";
    seasonYear: number;
  },
): Promise<BudgetView> {
  const { orgId, seasonYear } = input;

  try {
    const [budgetResult, spendResult, feesResult, openResult, seasonsResult] = await Promise.all([
      client.query<{ totalBudgetUsd: string | null; notes: string | null; updatedAt: string | null }>(
        `SELECT total_budget_usd::text AS "totalBudgetUsd", notes, updated_at::text AS "updatedAt"
           FROM season_budgets WHERE org_id = $1::uuid AND season_year = $2::int`,
        [orgId, seasonYear],
      ),
      client.query<{ source: string; outUsd: string; rowCount: number }>(SPEND_BY_SOURCE_SQL, [
        orgId,
        seasonYear,
      ]),
      client.query<{ status: string; amountUsd: string; rowCount: number }>(COMPETITION_FEES_SQL, [
        orgId,
        seasonYear,
      ]),
      client.query<{ status: string; amountUsd: string; rowCount: number }>(OPEN_PART_REQUESTS_SQL, [
        orgId,
        seasonYear,
      ]),
      client.query<{ seasonYear: number }>(SEASONS_SQL, [orgId]),
    ]);

    const spendBySource: BudgetSpendLine[] = spendResult.rows
      .filter((row) => isMoneySource(row.source))
      .map((row) => ({
        source: row.source as MoneySource,
        label: MONEY_SOURCE_LABELS[row.source as MoneySource],
        outUsd: usd(row.outUsd),
        rowCount: Number(row.rowCount) || 0,
      }))
      .filter((line) => line.rowCount > 0);

    const recordedSpendUsd = spendBySource.reduce((total, line) => total + line.outUsd, 0);
    const recordedRowCount = spendBySource.reduce((total, line) => total + line.rowCount, 0);

    const budgetRow = budgetResult.rows[0];
    const summary = summarizeBudget({
      totalBudgetUsd: budgetRow?.totalBudgetUsd == null ? null : usd(budgetRow.totalBudgetUsd),
      recordedSpendUsd,
      recordedRowCount,
    });

    const seasons = seasonsResult.rows.map((row) => Number(row.seasonYear));
    if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

    return {
      status: "ready",
      orgId,
      orgName: input.orgName,
      teamNumber: input.teamNumber,
      seasonYear,
      seasons,
      accessVia: input.accessVia,
      budget: {
        totalBudgetUsd: budgetRow?.totalBudgetUsd == null ? null : usd(budgetRow.totalBudgetUsd),
        notes: budgetRow?.notes ?? null,
        updatedAt: budgetRow?.updatedAt ?? null,
      },
      summary,
      spendBySource,
      competitionFees: feesResult.rows
        .filter((row) => row.status === "planned" || row.status === "paid")
        .map((row) => ({
          status: row.status as "planned" | "paid",
          amountUsd: usd(row.amountUsd),
          rowCount: Number(row.rowCount) || 0,
        })),
      openPartRequests: openResult.rows.map((row) => ({
        status: row.status,
        amountUsd: usd(row.amountUsd),
        rowCount: Number(row.rowCount) || 0,
      })),
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (missingTable(error)) {
      return {
        status: "setup_required",
        message: "Budget tables are not migrated yet. Run npm run db:migrate, then reload.",
        orgId,
        seasonYear,
      };
    }
    throw error;
  }
}

/**
 * Set (or clear) the season budget. RLS refuses this for anyone without the
 * `manage_budget` capability; the route checks first so the refusal is a sentence.
 *
 * `ai_assist_enabled` is preserved rather than defaulted — /costs and /orders
 * read that same column, and silently switching their finance assistant off
 * because this page did not send the field would be a change nobody asked for.
 */
export async function setSeasonBudget(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    totalBudgetUsd: number | null;
    notes: string | null;
  },
): Promise<void> {
  const updated = await client.query(
    `INSERT INTO season_budgets (org_id, season_year, total_budget_usd, notes, created_by)
     VALUES ($1::uuid, $2::int, $3::numeric, $4, $5::uuid)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       total_budget_usd = EXCLUDED.total_budget_usd,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [input.orgId, input.seasonYear, input.totalBudgetUsd, input.notes, input.userId],
  );
  if (!updated.rowCount) {
    throw new Error("The budget was not saved. You may no longer have budget access on this team.");
  }
}
