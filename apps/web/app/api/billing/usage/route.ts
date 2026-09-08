import { readOrgAllowance } from "@vantage/billing";
import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Team usage view. The allowance figures come from `readOrgAllowance`, which reads the
// same `org_billing` cap and `[period_start, period_end)` window that `meteredAI`
// enforces — so what a team is shown here is what the enforcer will actually do.
// Member and model breakdowns are scoped to the same period; a monthly allowance
// compared against a lifetime sum is not a number anyone can act on.

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_billing");
      const allowance = await readOrgAllowance(client, orgId);
      // No org_billing row means billing is not provisioned for this team. Report that
      // honestly rather than showing a $0 cap that looks like an exhausted allowance.
      const periodStart = allowance.periodStart;
      const periodEnd = allowance.periodEnd;
      const [members, models, entitlement, wallet, policy] = await Promise.all([
        client.query(
          `SELECT u.id, u.name, u.email,
                  COALESCE(sum(a.total_tokens), 0) AS tokens,
                  COALESCE(sum(a.cost_usd), 0) AS cost
             FROM memberships m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN ai_usage_events a
               ON a.user_id = u.id
              AND a.org_id = m.org_id
              AND ($2::timestamptz IS NULL OR a.created_at >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR a.created_at < $3::timestamptz)
            WHERE m.org_id = $1::uuid
            GROUP BY u.id`,
          [orgId, periodStart, periodEnd],
        ),
        client.query(
          `SELECT provider, model, sum(total_tokens) AS tokens, sum(cost_usd) AS cost, count(*) AS calls
             FROM ai_usage_events
            WHERE org_id = $1::uuid
              AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)
            GROUP BY provider, model
            ORDER BY cost DESC`,
          [orgId, periodStart, periodEnd],
        ),
        client.query(
          `SELECT e.plan_code AS "planCode", e.status, e.valid_until AS "validUntil",
                  p.included_allowance_usd AS "includedAllowance"
             FROM org_entitlements e
             JOIN pricing_plans p ON p.code = e.plan_code
            WHERE e.org_id = $1::uuid`,
          [orgId],
        ),
        client.query(
          `SELECT COALESCE(sum(amount_usd), 0) AS balance,
                  COALESCE(sum(provider_cost_usd), 0) AS "providerCost",
                  COALESCE(sum(service_markup_usd), 0) AS markup
             FROM wallet_ledger WHERE org_id = $1::uuid`,
          [orgId],
        ),
        client.query(
          `SELECT payg_enabled AS "paygEnabled", overage_spend_cap_usd AS "spendCap",
                  low_balance_warning_usd AS "lowBalanceWarning", kill_switch AS "killSwitch"
             FROM org_usage_policies WHERE org_id = $1::uuid`,
          [orgId],
        ),
      ]);
      return {
        allowance,
        members: members.rows,
        models: models.rows,
        entitlement: entitlement.rows[0] ?? null,
        wallet: wallet.rows[0],
        policy: policy.rows[0] ?? null,
        allowancePercent: allowance.percentUsed,
        cutoff: {
          planCode: entitlement.rows[0]?.planCode ?? allowance.tier ?? null,
          includedAllowanceUsd: allowance.includedAllowanceUsd,
          usedUsd: allowance.usedUsd,
          remainingUsd: allowance.remainingUsd,
          allowancePercent: allowance.percentUsed,
          periodStart: allowance.periodStart,
          periodEnd: allowance.periodEnd,
          walletBalanceUsd: Number(wallet.rows[0]?.balance ?? 0),
          paygEnabled: Boolean(policy.rows[0]?.paygEnabled),
          spendCapUsd: policy.rows[0]?.spendCap == null ? null : Number(policy.rows[0].spendCap),
          killSwitch: Boolean(policy.rows[0]?.killSwitch) || allowance.killSwitch,
          monthlySpendUsd: allowance.usedUsd,
          monthlySpendLimitUsd: allowance.includedAllowanceUsd || null,
          warningThresholds: [50, 75, 90],
        },
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Usage request failed" }, { status: 403 });
  }
}
