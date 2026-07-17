import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { summarizeMonthlyBudget } from "../../../../lib/finance";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Summary request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const [transactions, plans, sponsorTotals] = await Promise.all([
        client.query(
          `SELECT type, amount_usd AS "amountUsd", occurred_at AS "occurredAt", source, description
           FROM finance_transactions WHERE org_id=$1 AND season_year=$2 ORDER BY occurred_at`,
          [orgId, seasonYear],
        ),
        client.query(
          `SELECT COALESCE(sum(p.total_limit_usd),0)::text AS "totalLimitUsd",
                  COALESCE(sum(p.monthly_limit_usd),0)::text AS "monthlyLimitUsd"
           FROM finance_budget_plans p JOIN finance_categories c ON c.id=p.category_id
           WHERE c.org_id=$1 AND c.season_year=$2`,
          [orgId, seasonYear],
        ),
        client.query(
          `SELECT COALESCE(sum(amount_usd),0)::text AS "cashUsd" FROM sponsor_contributions
           WHERE org_id=$1 AND season_year=$2 AND type='cash'`,
          [orgId, seasonYear],
        ),
      ]);
      return {
        transactions: transactions.rows as {
          type: "income" | "expense"; amountUsd: string; occurredAt: string; source: string; description: string | null;
        }[],
        totalLimitUsd: Number(plans.rows[0]?.totalLimitUsd ?? 0) || null,
        monthlyLimitUsd: Number(plans.rows[0]?.monthlyLimitUsd ?? 0) || null,
        sponsorCashUsd: Number(sponsorTotals.rows[0]?.cashUsd ?? 0),
      };
    });
    const summary = summarizeMonthlyBudget({
      transactions: data.transactions.map((t) => ({ type: t.type, amountUsd: Number(t.amountUsd), occurredAt: t.occurredAt })),
      monthlyLimitUsd: data.monthlyLimitUsd,
      totalLimitUsd: data.totalLimitUsd,
    });
    return Response.json({ seasonYear, ...summary, sponsorCashUsd: data.sponsorCashUsd, transactions: data.transactions });
  } catch (error) { return fail(error); }
}
