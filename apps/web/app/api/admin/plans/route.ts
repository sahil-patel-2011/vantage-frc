import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  billingDisplayStatus,
  stripeWiringSnapshot,
  type OrgPlanLedgerRow,
} from "../../../../lib/admin-org-plans";

type OrgPlanQueryRow = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  planCode: string | null;
  planName: string | null;
  entitlementStatus: string | null;
  entitlementSource: string | null;
  includedAllowanceUsd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  memberCount: number;
  validUntil: string | null;
  trialEndsAt: string | null;
};

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");

    const payload = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);

      const rows = (
        await client.query<OrgPlanQueryRow>(
          `SELECT o.id, o.name, o.slug, o.team_number AS "teamNumber",
            e.plan_code AS "planCode",
            p.name AS "planName",
            e.status AS "entitlementStatus",
            e.source AS "entitlementSource",
            COALESCE(p.included_allowance_usd, 0)::text AS "includedAllowanceUsd",
            b.stripe_customer_id AS "stripeCustomerId",
            COALESCE(e.stripe_subscription_id, b.stripe_subscription_id) AS "stripeSubscriptionId",
            (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id) AS "memberCount",
            e.valid_until AS "validUntil",
            e.trial_ends_at AS "trialEndsAt"
           FROM organizations o
           LEFT JOIN org_entitlements e ON e.org_id = o.id
           LEFT JOIN pricing_plans p ON p.code = e.plan_code
           LEFT JOIN org_billing b ON b.org_id = o.id
           ORDER BY o.team_number NULLS LAST, o.name`,
        )
      ).rows;

      const priced =
        (
          await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pricing_plans
             WHERE active = true AND stripe_price_id IS NOT NULL AND btrim(stripe_price_id) <> ''`,
          )
        ).rows[0]?.count ?? 0;

      const organizations: OrgPlanLedgerRow[] = rows.map((row) => {
        const planCode = row.planCode?.trim() || "free";
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          teamNumber: row.teamNumber,
          planCode,
          planName: row.planName?.trim() || (planCode === "free" ? "Free" : planCode),
          status: billingDisplayStatus({
            planCode,
            entitlementStatus: row.entitlementStatus,
            entitlementSource: row.entitlementSource,
          }),
          entitlementStatus: row.entitlementStatus,
          entitlementSource: row.entitlementSource,
          includedAllowanceUsd: row.includedAllowanceUsd ?? "0",
          stripeCustomerId: row.stripeCustomerId,
          stripeSubscriptionId: row.stripeSubscriptionId,
          memberCount: row.memberCount,
          validUntil: row.validUntil,
          trialEndsAt: row.trialEndsAt,
        };
      });

      const planOptions = (
        await client.query<{ code: string; name: string }>(
          `SELECT code, name FROM pricing_plans WHERE active = true ORDER BY monthly_price_usd, name`,
        )
      ).rows;

      return {
        organizations,
        planOptions,
        stripeWiring: stripeWiringSnapshot({
          secretConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
          webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
          billingDbConfigured: Boolean(process.env.DATABASE_BILLING_URL?.trim()),
          plansWithStripePriceId: priced,
        }),
      };
    });

    return Response.json(payload);
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
