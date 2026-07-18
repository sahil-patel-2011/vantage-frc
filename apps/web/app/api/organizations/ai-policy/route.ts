import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import {
  FINANCE_IN_AI_ACK_VERSION,
  knownAiFeatures,
  knownAiTools,
  mapOrgAiPolicyRow,
  normalizeStringList,
  normalizeThresholds,
  parseOptionalUsd,
} from "@vantage/billing";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "AI policy request failed" },
    { status: 400 },
  );

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      const [policy, models, usage, pending, audit, budget] = await Promise.all([
        client.query(`SELECT * FROM org_ai_policies WHERE org_id=$1`, [orgId]),
        client.query(
          `SELECT provider, model, allowed,
                  daily_spend_limit_usd AS "dailySpendLimitUsd",
                  monthly_spend_limit_usd AS "monthlySpendLimitUsd"
           FROM org_api_model_limits WHERE org_id=$1 ORDER BY provider, model`,
          [orgId],
        ),
        client.query(
          `SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailySpend",
                  COALESCE(sum(cost_usd), 0)::text AS "monthlySpend",
                  COALESCE(sum(total_tokens) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailyTokens",
                  COALESCE(sum(total_tokens), 0)::text AS "monthlyTokens"
           FROM ai_usage_events
           WHERE org_id=$1 AND created_at >= date_trunc('month', now())`,
          [orgId],
        ),
        client.query(
          `SELECT count(*)::text AS count FROM ai_run_approvals
           WHERE org_id=$1 AND status='pending'`,
          [orgId],
        ),
        client.query(
          `SELECT id, action, before, after, created_at AS "createdAt",
                  actor_user_id AS "actorUserId"
           FROM org_ai_policy_audit WHERE org_id=$1
           ORDER BY created_at DESC LIMIT 20`,
          [orgId],
        ),
        client.query(
          `SELECT model_allowlist_enabled AS "modelAllowlistEnabled",
                  provider_allowlist_enabled AS "providerAllowlistEnabled",
                  warning_thresholds AS "warningThresholds",
                  kill_switch AS "killSwitch"
           FROM org_api_budget_policies WHERE org_id=$1`,
          [orgId],
        ),
      ]);

      return {
        policy: mapOrgAiPolicyRow(policy.rows[0] as Record<string, unknown> | undefined),
        models: models.rows,
        budget: budget.rows[0] ?? null,
        usage: usage.rows[0] ?? {
          dailySpend: "0",
          monthlySpend: "0",
          dailyTokens: "0",
          monthlyTokens: "0",
        },
        pendingApprovals: Number(pending.rows[0]?.count ?? 0),
        audit: audit.rows,
        catalog: {
          features: knownAiFeatures(),
          tools: knownAiTools(),
          financeInAiAckVersion: FINANCE_IN_AI_ACK_VERSION,
        },
      };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");

    const allowedFeatures = normalizeStringList(body.allowedFeatures);
    const allowedTools = normalizeStringList(body.allowedTools);
    const requireApprovalForFeatures = normalizeStringList(body.requireApprovalForFeatures);
    const spendAlertThresholds = normalizeThresholds(body.spendAlertThresholds);
    const highCostThresholdUsd = parseOptionalUsd(body.highCostThresholdUsd);
    const dailySpendAlertUsd = parseOptionalUsd(body.dailySpendAlertUsd);
    const monthlySpendAlertUsd = parseOptionalUsd(body.monthlySpendAlertUsd);
    const financeInAiEnabled = Boolean(body.financeInAiEnabled);
    const financeInAiRiskAccepted = body.financeInAiRiskAccepted === true;

    await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");

      const before =
        (await client.query(`SELECT * FROM org_ai_policies WHERE org_id=$1`, [orgId])).rows[0] ??
        null;
      const beforeMapped = mapOrgAiPolicyRow(before as Record<string, unknown> | undefined);

      let financeAcceptedAt: string | null = beforeMapped.financeInAiAcceptedAt;
      let financeAcceptedBy: string | null = beforeMapped.financeInAiAcceptedBy;
      let financeAckVersion: string | null = beforeMapped.financeInAiAckVersion;

      if (financeInAiEnabled) {
        const alreadyAccepted =
          beforeMapped.financeInAiAckVersion === FINANCE_IN_AI_ACK_VERSION &&
          Boolean(beforeMapped.financeInAiAcceptedAt);
        if (!alreadyAccepted && !financeInAiRiskAccepted) {
          throw new Error(
            "Enabling Finance-in-AI requires accepting the risk modal (financeInAiRiskAccepted).",
          );
        }
        if (financeInAiRiskAccepted || !alreadyAccepted) {
          financeAcceptedAt = new Date().toISOString();
          financeAcceptedBy = current.user.id;
          financeAckVersion = FINANCE_IN_AI_ACK_VERSION;
        }
      }

      await client.query(
        `INSERT INTO org_ai_policies(
           org_id, feature_allowlist_enabled, allowed_features, tool_allowlist_enabled, allowed_tools,
           high_cost_threshold_usd, require_approval_above_threshold, require_approval_for_features,
           admin_bypass_approval, daily_spend_alert_usd, monthly_spend_alert_usd,
           spend_alert_thresholds, finance_in_ai_enabled, finance_in_ai_accepted_at,
           finance_in_ai_accepted_by, finance_in_ai_ack_version, updated_by
         ) VALUES (
           $1,$2,$3::text[],$4,$5::text[],$6,$7,$8::text[],$9,$10,$11,$12::integer[],$13,$14::timestamptz,$15,$16,$17
         )
         ON CONFLICT (org_id) DO UPDATE SET
           feature_allowlist_enabled=EXCLUDED.feature_allowlist_enabled,
           allowed_features=EXCLUDED.allowed_features,
           tool_allowlist_enabled=EXCLUDED.tool_allowlist_enabled,
           allowed_tools=EXCLUDED.allowed_tools,
           high_cost_threshold_usd=EXCLUDED.high_cost_threshold_usd,
           require_approval_above_threshold=EXCLUDED.require_approval_above_threshold,
           require_approval_for_features=EXCLUDED.require_approval_for_features,
           admin_bypass_approval=EXCLUDED.admin_bypass_approval,
           daily_spend_alert_usd=EXCLUDED.daily_spend_alert_usd,
           monthly_spend_alert_usd=EXCLUDED.monthly_spend_alert_usd,
           spend_alert_thresholds=EXCLUDED.spend_alert_thresholds,
           finance_in_ai_enabled=EXCLUDED.finance_in_ai_enabled,
           finance_in_ai_accepted_at=EXCLUDED.finance_in_ai_accepted_at,
           finance_in_ai_accepted_by=EXCLUDED.finance_in_ai_accepted_by,
           finance_in_ai_ack_version=EXCLUDED.finance_in_ai_ack_version,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()`,
        [
          orgId,
          Boolean(body.featureAllowlistEnabled),
          allowedFeatures,
          Boolean(body.toolAllowlistEnabled),
          allowedTools,
          highCostThresholdUsd,
          Boolean(body.requireApprovalAboveThreshold),
          requireApprovalForFeatures,
          body.adminBypassApproval !== false,
          dailySpendAlertUsd,
          monthlySpendAlertUsd,
          spendAlertThresholds,
          financeInAiEnabled,
          financeAcceptedAt,
          financeAcceptedBy,
          financeAckVersion,
          current.user.id,
        ],
      );

      await client.query(
        `INSERT INTO org_api_budget_policies(org_id, warning_thresholds, updated_by)
         VALUES ($1, $2::integer[], $3)
         ON CONFLICT (org_id) DO UPDATE SET
           warning_thresholds=EXCLUDED.warning_thresholds,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()`,
        [orgId, spendAlertThresholds, current.user.id],
      );

      await client.query(
        `INSERT INTO org_ai_policy_audit(org_id, actor_user_id, action, before, after)
         VALUES ($1,$2,'ai_policy.updated',$3::jsonb,$4::jsonb)`,
        [
          orgId,
          current.user.id,
          JSON.stringify(before),
          JSON.stringify({
            ...body,
            financeInAiAckVersion: financeAckVersion,
            financeInAiAcceptedAt: financeAcceptedAt,
          }),
        ],
      );
    });

    return Response.json({ success: true, financeInAiAckVersion: FINANCE_IN_AI_ACK_VERSION });
  } catch (error) {
    return fail(error);
  }
}