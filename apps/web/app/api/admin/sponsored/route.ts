import { assertPlatformAdmin, auth, platformAdminDeniedResponse, writeAdminAction } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Platform governance for sponsored / free-tier AI: the economics roll-up
// (free_ai_economics), recent sponsored calls including denied/failed rows with
// their reason (sponsored_ai_usage_events), and the platform_free_ai_policy that
// gates it. All three are platform-admin-only by RLS. The one write is a kill
// switch — enabling requires a fully-configured policy, which the DB CHECK
// constraint enforces (an invalid enable is surfaced as an error). Every toggle
// is audited to admin_actions.

const USAGE_LIMIT = 100;

async function runAdmin<T>(work: Parameters<typeof withRls<T>>[1]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    return work(client);
  });
}

export async function GET() {
  try {
    return Response.json(
      await runAdmin(async (client) => {
        const [policy, economics, recentUsage, byOutcome] = await Promise.all([
          client.query(
            `SELECT p.enabled, p.sponsored_model_id AS "sponsoredModelId", m.display_name AS "sponsoredModel",
                    p.monthly_allowance_usd AS "monthlyAllowanceUsd",
                    p.org_daily_request_limit AS "orgDailyLimit",
                    p.user_daily_request_limit AS "userDailyLimit",
                    p.ip_daily_request_limit AS "ipDailyLimit",
                    p.concurrency_limit AS "concurrencyLimit",
                    p.require_verified_email AS "requireVerifiedEmail",
                    p.require_closed_team_membership AS "requireClosedTeam",
                    p.updated_at AS "updatedAt"
             FROM platform_free_ai_policy p
             LEFT JOIN model_catalog m ON m.id = p.sponsored_model_id
             WHERE p.id='default'`,
          ),
          client.query(`SELECT * FROM free_ai_economics`),
          client.query(
            `SELECT s.id, s.created_at AS "createdAt", s.status, s.denial_reason AS "denialReason",
                    s.provider_cost_usd AS "providerCostUsd", o.name AS "orgName",
                    o.team_number AS "teamNumber", m.display_name AS "model"
             FROM sponsored_ai_usage_events s
             LEFT JOIN organizations o ON o.id = s.org_id
             LEFT JOIN model_catalog m ON m.id = s.model_id
             ORDER BY s.created_at DESC
             LIMIT ${USAGE_LIMIT}`,
          ),
          client.query(
            `SELECT status, denial_reason AS "denialReason", count(*) AS count
             FROM sponsored_ai_usage_events
             WHERE created_at >= now() - interval '30 days'
             GROUP BY status, denial_reason ORDER BY count DESC`,
          ),
        ]);
        return {
          policy: policy.rows[0] ?? null,
          economics: economics.rows[0] ?? null,
          recentUsage: recentUsage.rows,
          byOutcome: byOutcome.rows,
        };
      }),
    );
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    await runAdmin(async (client) => {
      const actor = (await client.query<{ id: string }>("SELECT current_app_user_id() AS id")).rows[0]!.id;
      await client.query(
        `UPDATE platform_free_ai_policy SET enabled=$1, updated_by=$2, updated_at=now() WHERE id='default'`,
        [body.enabled, actor],
      );
      await writeAdminAction(client, {
        actorUserId: actor,
        action: `sponsored_ai.${body.enabled ? "enabled" : "disabled"}`,
        payload: { enabled: body.enabled },
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /platform administrator|authentication required/i.test(error.message)) {
      return platformAdminDeniedResponse(error);
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Sponsored policy update failed" },
      { status: 400 },
    );
  }
}
