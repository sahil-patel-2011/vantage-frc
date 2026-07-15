import { giftUsageCredits, grantTrial } from "@vantage/billing";
import { assertPlatformPrivilegeMfa,auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function runAdmin<T>(work: Parameters<typeof withRls<T>>[1],requireMfa=false) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    if (!(await client.query("SELECT is_platform_admin() AS value")).rows[0]?.value)
      throw new Error("Platform administrator access required");
    if(requireMfa)await assertPlatformPrivilegeMfa(client,{userId:session.user.id,sessionId:session.session.id});
    return work(client);
  });
}

export async function GET() {
  try {
    return Response.json(await runAdmin(async (client) => {
      const config=(await client.query(`SELECT stripe_fee_percent AS "stripeFeePercent",stripe_fixed_fee_usd AS "stripeFixedFeeUsd",infrastructure_allocation_usd AS "infrastructureAllocationUsd",gross_margin_warning_percent AS "grossMarginWarningPercent" FROM platform_margin_config WHERE id='default'`)).rows[0]??{stripeFeePercent:"2.9",stripeFixedFeeUsd:".30",infrastructureAllocationUsd:"2",grossMarginWarningPercent:"10"};
      const margin=(await client.query(`SELECT COALESCE(sum(p.monthly_price_usd),0)::text AS revenue,COALESCE(sum(period.provider_cost_used_usd),0)::text AS "providerCost",count(*)::int AS subscriptions FROM org_entitlements e JOIN pricing_plans p ON p.code=e.plan_code LEFT JOIN org_plan_periods period ON period.org_id=e.org_id AND period.status='active' WHERE e.status IN ('active','trialing')`)).rows[0];
      return{
      organizations: (await client.query(
        `SELECT o.id,o.name,o.team_number AS "teamNumber",e.plan_code AS "planCode",e.status,
          e.valid_until AS "validUntil",COALESCE((SELECT sum(amount_usd) FROM wallet_ledger w WHERE w.org_id=o.id),0) AS "creditBalance",
          COALESCE((SELECT sum(cost_usd) FROM ai_usage_events a WHERE a.org_id=o.id),0) AS "modelCost"
         FROM organizations o LEFT JOIN org_entitlements e ON e.org_id=o.id ORDER BY o.team_number`,
      )).rows,
      packs: (await client.query("SELECT * FROM credit_packs ORDER BY purchase_price_usd")).rows,
      margin:{...margin,config},
    };}));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await runAdmin(async (client) => {
      const actor = (await client.query<{ id: string }>("SELECT current_app_user_id() AS id")).rows[0]!.id;
      if (body.action === "gift") {
        await giftUsageCredits(client, {
          orgId: String(body.orgId), amountUsd: Number(body.amountUsd),
          actorUserId: actor, reason: String(body.reason ?? ""),
        });
      } else if (body.action === "trial") {
        if (!["managed_20","managed_50"].includes(String(body.planCode))) throw new Error("Invalid trial plan");
        await grantTrial(client, { orgId: String(body.orgId), planCode: body.planCode as "managed_20" | "managed_50", actorUserId: actor });
      } else if (body.action === "revoke-trial") {
        await client.query(`UPDATE org_entitlements SET status='revoked',valid_until=now(),updated_by=$2,updated_at=now()
          WHERE org_id=$1 AND source='admin_trial'`, [body.orgId, actor]);
        await client.query(`INSERT INTO entitlement_events(org_id,plan_code,action,source,actor_user_id)
          SELECT org_id,plan_code,'trial_revoked','admin',$2 FROM org_entitlements WHERE org_id=$1`, [body.orgId, actor]);
      } else if (body.action === "credit-pack") {
        await client.query(`INSERT INTO credit_packs(code,name,credit_amount_usd,purchase_price_usd,stripe_price_id,active)
          VALUES($1,$2,$3,$4,NULLIF($5,''),$6) ON CONFLICT(code) DO UPDATE SET name=excluded.name,
          credit_amount_usd=excluded.credit_amount_usd,purchase_price_usd=excluded.purchase_price_usd,
          stripe_price_id=excluded.stripe_price_id,active=excluded.active,updated_at=now()`,
          [body.code,body.name,body.creditAmountUsd,body.purchasePriceUsd,body.stripePriceId,body.active]);
      } else throw new Error("Unknown commercial action");
    },true);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
  }
}
