import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Budget request failed" }, { status: 400 });
const limits = (body: Record<string, unknown>) => [
  body.dailySpendLimitUsd ?? null, body.monthlySpendLimitUsd ?? null,
  body.dailyTokenLimit ?? null, body.monthlyTokenLimit ?? null,
];

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const [policy, members, features, models, usage] = await Promise.all([
        client.query(`SELECT daily_spend_limit_usd AS "dailySpendLimitUsd",
          monthly_spend_limit_usd AS "monthlySpendLimitUsd",daily_token_limit AS "dailyTokenLimit",
          monthly_token_limit AS "monthlyTokenLimit",warning_thresholds AS "warningThresholds",
          enforce_byo_token_limits AS "enforceByoTokenLimits",model_allowlist_enabled AS "modelAllowlistEnabled",
          provider_allowlist_enabled AS "providerAllowlistEnabled",kill_switch AS "killSwitch"
          FROM org_api_budget_policies WHERE org_id=$1`, [orgId]),
        client.query(`SELECT l.user_id AS "userId",u.name,u.email,l.daily_spend_limit_usd AS "dailySpendLimitUsd",
          l.monthly_spend_limit_usd AS "monthlySpendLimitUsd",l.daily_token_limit AS "dailyTokenLimit",
          l.monthly_token_limit AS "monthlyTokenLimit" FROM memberships m JOIN users u ON u.id=m.user_id
          LEFT JOIN org_api_member_limits l ON l.org_id=m.org_id AND l.user_id=m.user_id WHERE m.org_id=$1`, [orgId]),
        client.query(`SELECT feature,daily_spend_limit_usd AS "dailySpendLimitUsd",
          monthly_spend_limit_usd AS "monthlySpendLimitUsd",daily_token_limit AS "dailyTokenLimit",
          monthly_token_limit AS "monthlyTokenLimit" FROM org_api_feature_limits WHERE org_id=$1`, [orgId]),
        client.query(`SELECT provider,model,allowed,daily_spend_limit_usd AS "dailySpendLimitUsd",
          monthly_spend_limit_usd AS "monthlySpendLimitUsd",daily_token_limit AS "dailyTokenLimit",
          monthly_token_limit AS "monthlyTokenLimit" FROM org_api_model_limits WHERE org_id=$1`, [orgId]),
        client.query(`SELECT COALESCE(sum(cost_usd) FILTER(WHERE created_at>=date_trunc('day',now())),0)::text AS "dailySpend",
          COALESCE(sum(cost_usd),0)::text AS "monthlySpend",
          COALESCE(sum(total_tokens) FILTER(WHERE created_at>=date_trunc('day',now())),0)::text AS "dailyTokens",
          COALESCE(sum(total_tokens),0)::text AS "monthlyTokens"
          FROM ai_usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now())`, [orgId]),
      ]);
      const row = usage.rows[0] as Record<string, string>;
      const elapsedDays = Math.max(1, new Date().getUTCDate());
      const monthlyLimit = Number(policy.rows[0]?.monthlySpendLimitUsd ?? 0);
      const dailyRate = Number(row.monthlySpend ?? 0) / elapsedDays;
      return {
        policy: policy.rows[0] ?? null, members: members.rows, features: features.rows, models: models.rows,
        usage: row,
        projectedExhaustionDays: monthlyLimit > 0 && dailyRate > 0
          ? Math.max(0, (monthlyLimit - Number(row.monthlySpend)) / dailyRate) : null,
      };
    });
    return Response.json(data);
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const thresholds = (body.warningThresholds as number[] | undefined) ?? [50, 75, 90];
    if (thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 99))
      throw new Error("Warning thresholds must be whole percentages from 1 to 99");
    await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      let before: unknown;
      if (body.scope === "org") {
        before = (await client.query("SELECT * FROM org_api_budget_policies WHERE org_id=$1", [orgId])).rows[0] ?? null;
        await client.query(`INSERT INTO org_api_budget_policies(org_id,daily_spend_limit_usd,
          monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,warning_thresholds,
          enforce_byo_token_limits,model_allowlist_enabled,provider_allowlist_enabled,kill_switch,updated_by)
          VALUES($1,$2,$3,$4,$5,$6::integer[],$7,$8,$9,$10,$11) ON CONFLICT(org_id) DO UPDATE SET
          daily_spend_limit_usd=excluded.daily_spend_limit_usd,monthly_spend_limit_usd=excluded.monthly_spend_limit_usd,
          daily_token_limit=excluded.daily_token_limit,monthly_token_limit=excluded.monthly_token_limit,
          warning_thresholds=excluded.warning_thresholds,enforce_byo_token_limits=excluded.enforce_byo_token_limits,
          model_allowlist_enabled=excluded.model_allowlist_enabled,provider_allowlist_enabled=excluded.provider_allowlist_enabled,
          kill_switch=excluded.kill_switch,updated_by=excluded.updated_by,updated_at=now()`,
          [orgId,...limits(body),thresholds,body.enforceByoTokenLimits !== false,Boolean(body.modelAllowlistEnabled),
            Boolean(body.providerAllowlistEnabled),Boolean(body.killSwitch),current.user.id]);
      } else {
        const tables = { member: ["org_api_member_limits","user_id"], feature: ["org_api_feature_limits","feature"], model: ["org_api_model_limits","provider,model"] } as const;
        const config = tables[body.scope as keyof typeof tables];
        if (!config) throw new Error("Invalid budget scope");
        const identity = body.scope === "member" ? [body.userId] : body.scope === "feature" ? [body.feature] : [body.provider, body.model];
        if (identity.some((value) => !value)) throw new Error("Budget scope identifier is required");
        const where = body.scope === "model" ? "provider=$2 AND model=$3" : `${config[1]}=$2`;
        before = (await client.query(`SELECT * FROM ${config[0]} WHERE org_id=$1 AND ${where}`, [orgId,...identity])).rows[0] ?? null;
        if (body.scope === "model") {
          await client.query(`INSERT INTO org_api_model_limits(org_id,provider,model,allowed,daily_spend_limit_usd,
            monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT(org_id,provider,model) DO UPDATE SET allowed=excluded.allowed,daily_spend_limit_usd=excluded.daily_spend_limit_usd,
            monthly_spend_limit_usd=excluded.monthly_spend_limit_usd,daily_token_limit=excluded.daily_token_limit,
            monthly_token_limit=excluded.monthly_token_limit,updated_by=excluded.updated_by,updated_at=now()`,
            [orgId,...identity,body.allowed !== false,...limits(body),current.user.id]);
        } else {
          await client.query(`INSERT INTO ${config[0]}(org_id,${config[1]},daily_spend_limit_usd,
            monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(org_id,${config[1]}) DO UPDATE SET daily_spend_limit_usd=excluded.daily_spend_limit_usd,
            monthly_spend_limit_usd=excluded.monthly_spend_limit_usd,daily_token_limit=excluded.daily_token_limit,
            monthly_token_limit=excluded.monthly_token_limit,updated_by=excluded.updated_by,updated_at=now()`,
            [orgId,...identity,...limits(body),current.user.id]);
        }
      }
      await client.query(`INSERT INTO budget_policy_audit(org_id,actor_user_id,action,before,after)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`, [orgId,current.user.id,`budget.${String(body.scope)}.updated`,
        JSON.stringify(before),JSON.stringify(body)]);
    });
    return Response.json({ success: true });
  } catch (error) { return fail(error); }
}
