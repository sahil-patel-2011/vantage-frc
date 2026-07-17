import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_billing");
      const [members, models, entitlement, wallet, policy] = await Promise.all([
        client.query(`SELECT u.id,u.name,u.email,COALESCE(sum(a.total_tokens),0) AS tokens,
          COALESCE(sum(a.cost_usd),0) AS cost FROM memberships m JOIN users u ON u.id=m.user_id
          LEFT JOIN ai_usage_events a ON a.user_id=u.id AND a.org_id=m.org_id WHERE m.org_id=$1 GROUP BY u.id`, [orgId]),
        client.query(`SELECT provider,model,sum(total_tokens) AS tokens,sum(cost_usd) AS cost,count(*) AS calls
          FROM ai_usage_events WHERE org_id=$1 GROUP BY provider,model ORDER BY cost DESC`, [orgId]),
        client.query(`SELECT e.plan_code AS "planCode",e.status,e.valid_until AS "validUntil",
          p.included_allowance_usd AS "includedAllowance" FROM org_entitlements e
          JOIN pricing_plans p ON p.code=e.plan_code WHERE e.org_id=$1`, [orgId]),
        client.query(`SELECT COALESCE(sum(amount_usd),0) AS balance,
          COALESCE(sum(provider_cost_usd),0) AS "providerCost",
          COALESCE(sum(service_markup_usd),0) AS markup FROM wallet_ledger WHERE org_id=$1`, [orgId]),
        client.query(`SELECT payg_enabled AS "paygEnabled",overage_spend_cap_usd AS "spendCap",
          low_balance_warning_usd AS "lowBalanceWarning",kill_switch AS "killSwitch"
          FROM org_usage_policies WHERE org_id=$1`, [orgId]),
      ]);
      const allowance = Number(entitlement.rows[0]?.includedAllowance ?? 0);
      const used = models.rows.reduce((sum, row) => sum + Number(row.cost), 0);
      return {
        members: members.rows, models: models.rows, entitlement: entitlement.rows[0] ?? null,
        wallet: wallet.rows[0], policy: policy.rows[0] ?? null,
        allowancePercent: allowance > 0 ? Math.min(100, (used / allowance) * 100) : null,
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Usage request failed" }, { status: 403 });
  }
}
