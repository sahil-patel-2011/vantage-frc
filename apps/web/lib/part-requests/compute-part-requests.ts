/**
 * PART REQUESTS — the student half of the money loop.
 *
 * A student cannot see the budget, but they can ask for a part. That ask is
 * their own row in `purchase_requests` (0035): the table's INSERT policy has
 * always been `is_org_member(org_id) AND requested_by = current_app_user_id()`,
 * so a student can create their own request and nobody else's, and the
 * `purchase_requests_member_self_edit` policy lets them fix it only while it is
 * still pending.
 *
 * Approving is the privileged act, and it is where the money moves:
 * `reviewOrder()` in lib/orders/compute-orders.ts writes the approval and, in
 * the SAME transaction, mirrors the committed dollars onto the unified ledger
 * (`recordMoney`, source 'purchase_request'), which is exactly the total
 * /budget subtracts from the season budget. Rejecting a previously approved
 * request removes the mirror again. None of that is re-implemented here — this
 * module is the request-shaped view over it, plus the honest budget context a
 * mentor needs at the moment they say yes.
 *
 * /orders remains the full treasurer console (buyers, links, receiving,
 * lead times). This page is the narrow path: ask, and decide.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { summarizeBudget, usd, type BudgetSummary } from "../budget/compute-budget";
import { statusLabel, type OrderStatus } from "../orders/evaluate";

export type PartRequest = {
  id: string;
  title: string;
  justification: string | null;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: number;
  totalCostUsd: number;
  status: OrderStatus;
  statusLabel: string;
  neededBy: string | null;
  requestedBy: string;
  requestedByName: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  createdAt: string;
  /** True when the signed-in person opened this request. */
  mine: boolean;
};

export type PartRequestsView =
  | { status: "setup_required"; message: string; orgId: string | null; seasonYear: number }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      seasonYear: number;
      /** Approving/rejecting is gated on this, in the API and in RLS. */
      canDecide: boolean;
      mine: PartRequest[];
      /** Everyone's pending asks — only populated for a budget manager. */
      queue: PartRequest[];
      /**
       * What approving would be measured against. Null for students: the budget
       * is not theirs to see, and this is null because the DATABASE returned
       * nothing, not because the page hid it.
       */
      budget: BudgetSummary | null;
      computedAt: string;
    };

const REQUEST_FIELDS = `
  p.id::text AS id,
  p.title,
  p.justification,
  p.vendor,
  p.item_url AS "itemUrl",
  p.quantity,
  p.unit_cost_usd::text AS "unitCostUsd",
  p.total_cost_usd::text AS "totalCostUsd",
  p.status::text AS status,
  p.needed_by::text AS "neededBy",
  p.requested_by::text AS "requestedBy",
  r.name AS "requestedByName",
  v.name AS "reviewedByName",
  p.review_notes AS "reviewNotes",
  p.created_at::text AS "createdAt"`;

type RequestRow = {
  id: string;
  title: string;
  justification: string | null;
  vendor: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: string;
  totalCostUsd: string;
  status: OrderStatus;
  neededBy: string | null;
  requestedBy: string;
  requestedByName: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  createdAt: string;
};

function mapRequest(row: RequestRow, userId: string): PartRequest {
  return {
    id: row.id,
    title: row.title,
    justification: row.justification,
    vendor: row.vendor,
    itemUrl: row.itemUrl,
    quantity: Number(row.quantity) || 0,
    unitCostUsd: usd(row.unitCostUsd),
    totalCostUsd: usd(row.totalCostUsd),
    status: row.status,
    statusLabel: statusLabel(row.status),
    neededBy: row.neededBy,
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName,
    reviewedByName: row.reviewedByName,
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt,
    mine: row.requestedBy === userId,
  };
}

function missingTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "42P01" || code === "42703" || code === "42883";
}

export async function computePartRequestsView(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    userId: string;
    canDecide: boolean;
    seasonYear: number;
  },
): Promise<PartRequestsView> {
  const { orgId, userId, seasonYear } = input;

  try {
    const mineResult = await client.query<RequestRow>(
      `SELECT ${REQUEST_FIELDS}
         FROM purchase_requests p
         LEFT JOIN users r ON r.id = p.requested_by
         LEFT JOIN users v ON v.id = p.reviewed_by
        WHERE p.org_id = $1::uuid
          AND p.season_year = $2::int
          AND p.requested_by = $3::uuid
        ORDER BY p.created_at DESC
        LIMIT 200`,
      [orgId, seasonYear, userId],
    );

    const queueResult = input.canDecide
      ? await client.query<RequestRow>(
          `SELECT ${REQUEST_FIELDS}
             FROM purchase_requests p
             LEFT JOIN users r ON r.id = p.requested_by
             LEFT JOIN users v ON v.id = p.reviewed_by
            WHERE p.org_id = $1::uuid
              AND p.season_year = $2::int
              AND p.status = 'pending'
            ORDER BY p.needed_by NULLS LAST, p.created_at
            LIMIT 200`,
          [orgId, seasonYear],
        )
      : null;

    // Deliberately one query per side of the budget rather than a join: for a
    // student BOTH come back empty because RLS refuses season_budgets, and the
    // view reports "no budget context" instead of a zero.
    let budget: BudgetSummary | null = null;
    if (input.canDecide) {
      const [budgetRow, spendRow] = await Promise.all([
        client.query<{ totalBudgetUsd: string | null }>(
          `SELECT total_budget_usd::text AS "totalBudgetUsd"
             FROM season_budgets WHERE org_id = $1::uuid AND season_year = $2::int`,
          [orgId, seasonYear],
        ),
        client.query<{ outUsd: string; rowCount: number }>(
          `SELECT COALESCE(SUM(amount_usd), 0)::text AS "outUsd", COUNT(*)::int AS "rowCount"
             FROM finance_transactions
            WHERE org_id = $1::uuid
              AND season_year = $2::int
              AND type = 'expense'
              AND counts_in_balance
              AND amount_usd > 0`,
          [orgId, seasonYear],
        ),
      ]);
      const total = budgetRow.rows[0]?.totalBudgetUsd;
      budget = summarizeBudget({
        totalBudgetUsd: total == null ? null : usd(total),
        recordedSpendUsd: usd(spendRow.rows[0]?.outUsd),
        recordedRowCount: Number(spendRow.rows[0]?.rowCount) || 0,
      });
    }

    return {
      status: "ready",
      orgId,
      orgName: input.orgName,
      seasonYear,
      canDecide: input.canDecide,
      mine: mineResult.rows.map((row) => mapRequest(row, userId)),
      queue: (queueResult?.rows ?? []).map((row) => mapRequest(row, userId)),
      budget,
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (missingTable(error)) {
      return {
        status: "setup_required",
        message: "Purchase tables are not migrated yet. Run npm run db:migrate, then reload.",
        orgId,
        seasonYear,
      };
    }
    throw error;
  }
}

/**
 * One line telling a mentor what saying yes costs, before they say it. Returns
 * null when there is no honest comparison to draw — never a filler percentage.
 */
export function describeApprovalImpact(
  budget: BudgetSummary | null,
  requestTotalUsd: number,
): string | null {
  if (!budget) return null;
  const money = (value: number) =>
    value.toLocaleString(undefined, { style: "currency", currency: "USD" });

  if (budget.state === "no_budget" || budget.state === "no_budget_no_spend") {
    return `${money(requestTotalUsd)} would be recorded as spend. No season budget is set to measure it against.`;
  }
  if (budget.state === "budget_no_spend") {
    return `${money(requestTotalUsd)} would be the first spending recorded against the ${money(budget.totalBudgetUsd ?? 0)} budget.`;
  }
  const remainingAfter = (budget.remainingUsd ?? 0) - requestTotalUsd;
  return `${money(requestTotalUsd)} would leave ${money(remainingAfter)} of the ${money(budget.totalBudgetUsd ?? 0)} budget.`;
}
