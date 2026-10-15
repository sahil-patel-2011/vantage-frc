import { readOrgAllowance, TEAM_USAGE_SQL } from "@vantage/billing";
import { assertHubTabAccess, assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { withSavepoint } from "@vantage/db/savepoint";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../../lib/security/public-error";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: publicErrorMessage(error, "Budget request failed") }, { status: 400 });
const limits = (body: Record<string, unknown>) => [
  body.dailySpendLimitUsd ?? null, body.monthlySpendLimitUsd ?? null,
  body.dailyTokenLimit ?? null, body.monthlyTokenLimit ?? null,
];

/** 401 for no session, 403 for someone this team's AI limits are hidden from, else 400. */
function readFail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = /authentication required/i.test(message)
    ? 401
    : /membership required|do not have access/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: publicErrorMessage(error, "Budget request failed") }, { status });
}

type BudgetSnapshot = {
  policy: Record<string, unknown> | null;
  usage: Record<string, string> | null;
  entitlement: { planCode: string | null; status: string | null; includedAllowance: string | null } | null;
  walletBalance: string | null;
  usagePolicy: { paygEnabled: boolean | null; spendCap: string | null; killSwitch: boolean | null } | null;
  canManage: boolean | null;
};

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      // The page now starts this read before /api/me answers, so the AI-limits tab gate the
      // page used to apply first is enforced here: a hidden tab answers 403.
      await assertHubTabAccess(client, orgId, current.user.id, "ai", "budgets");
      // A transaction has one pg connection, so reads cannot overlap: the six one-row reads
      // (policy, month usage, plan, wallet, usage policy, can-manage) are one statement (was
      // six). Numeric columns are cast to text so the JSON matches what pg returned before.
      const snapshot = await client.query<BudgetSnapshot>(
        `SELECT
           (SELECT to_jsonb(p) FROM (
              SELECT daily_spend_limit_usd::text AS "dailySpendLimitUsd",
                     monthly_spend_limit_usd::text AS "monthlySpendLimitUsd",
                     daily_token_limit AS "dailyTokenLimit", monthly_token_limit AS "monthlyTokenLimit",
                     warning_thresholds AS "warningThresholds",
                     enforce_byo_token_limits AS "enforceByoTokenLimits",
                     model_allowlist_enabled AS "modelAllowlistEnabled",
                     provider_allowlist_enabled AS "providerAllowlistEnabled",
                     kill_switch AS "killSwitch", prompt_caching_enabled AS "promptCachingEnabled"
              FROM org_api_budget_policies WHERE org_id = $1::uuid LIMIT 1) p) AS policy,
           (SELECT to_jsonb(u) FROM (
              SELECT COALESCE(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailySpend",
                     COALESCE(sum(cost_usd), 0)::text AS "monthlySpend",
                     COALESCE(sum(total_tokens) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS "dailyTokens",
                     COALESCE(sum(total_tokens), 0)::text AS "monthlyTokens"
              FROM ai_usage_events WHERE org_id = $1::uuid AND created_at >= date_trunc('month', now()) AND ${TEAM_USAGE_SQL}) u) AS usage,
           (SELECT to_jsonb(e) FROM (
              SELECT oe.plan_code AS "planCode", oe.status::text AS status,
                     pp.included_allowance_usd::text AS "includedAllowance"
              FROM org_entitlements oe JOIN pricing_plans pp ON pp.code = oe.plan_code
              WHERE oe.org_id = $1::uuid LIMIT 1) e) AS entitlement,
           (SELECT COALESCE(sum(amount_usd), 0)::text FROM wallet_ledger WHERE org_id = $1::uuid) AS "walletBalance",
           (SELECT to_jsonb(x) FROM (
              SELECT payg_enabled AS "paygEnabled", overage_spend_cap_usd::text AS "spendCap",
                     kill_switch AS "killSwitch"
              FROM org_usage_policies WHERE org_id = $1::uuid LIMIT 1) x) AS "usagePolicy",
           has_org_capability($1::uuid, 'manage_api_keys'::org_capability) AS "canManage"`,
        [orgId],
      );
      const snap = snapshot.rows[0];
      const canManage = snap?.canManage === true;
      const features = await client.query(`SELECT feature,daily_spend_limit_usd AS "dailySpendLimitUsd",
          monthly_spend_limit_usd AS "monthlySpendLimitUsd",daily_token_limit AS "dailyTokenLimit",
          monthly_token_limit AS "monthlyTokenLimit" FROM org_api_feature_limits WHERE org_id=$1`, [orgId]);
      const models = await client.query(`SELECT provider,model,allowed,daily_spend_limit_usd AS "dailySpendLimitUsd",
          monthly_spend_limit_usd AS "monthlySpendLimitUsd",daily_token_limit AS "dailyTokenLimit",
          monthly_token_limit AS "monthlyTokenLimit" FROM org_api_model_limits WHERE org_id=$1`, [orgId]);
      // Only people who can change limits see the member list, so only they pay for the read.
      const members = canManage
        ? (await client.query(`SELECT l.user_id AS "userId",u.name,u.email,l.daily_spend_limit_usd AS "dailySpendLimitUsd",
          l.monthly_spend_limit_usd AS "monthlySpendLimitUsd",l.daily_token_limit AS "dailyTokenLimit",
          l.monthly_token_limit AS "monthlyTokenLimit",
          COALESCE((to_jsonb(l) ->> 'ai_blocked')::boolean,false) AS "aiBlocked"
          FROM memberships m JOIN users u ON u.id=m.user_id
          LEFT JOIN org_api_member_limits l ON l.org_id=m.org_id AND l.user_id=m.user_id WHERE m.org_id=$1`, [orgId])).rows
        : [];
      const policy = snap?.policy ?? null;
      const row = (snap?.usage ?? {}) as Record<string, string>;
      const entitlement = snap?.entitlement ?? null;
      const usagePolicy = snap?.usagePolicy ?? null;
      const elapsedDays = Math.max(1, new Date().getUTCDate());
      const monthlyLimit = Number(policy?.monthlySpendLimitUsd ?? 0);
      const dailyRate = Number(row.monthlySpend ?? 0) / elapsedDays;
      const included = Number(entitlement?.includedAllowance ?? 0);
      const used = Number(row.monthlySpend ?? 0);
      const policyKill = Boolean(policy?.killSwitch);
      const usageKill = Boolean(usagePolicy?.killSwitch);
      // Whether the team has an AI key at all: without one the spend tiles are a row of $0.00.
      const allowance = await withSavepoint(client, () => readOrgAllowance(client, orgId), null);
      return {
        aiKeyConfigured: allowance ? allowance.configured : null,
        policy,
        members,
        canManage,
        features: features.rows, models: models.rows,
        usage: row,
        projectedExhaustionDays: monthlyLimit > 0 && dailyRate > 0
          ? Math.max(0, (monthlyLimit - Number(row.monthlySpend)) / dailyRate) : null,
        cutoff: {
          planCode: entitlement?.planCode ?? null,
          includedAllowanceUsd: included,
          usedUsd: used,
          allowancePercent: included > 0 ? Math.min(999, (used / included) * 100) : null,
          walletBalanceUsd: Number(snap?.walletBalance ?? 0),
          paygEnabled: Boolean(usagePolicy?.paygEnabled),
          spendCapUsd: usagePolicy?.spendCap == null ? null : Number(usagePolicy.spendCap),
          killSwitch: policyKill || usageKill,
          monthlySpendUsd: used,
          monthlySpendLimitUsd: monthlyLimit > 0 ? monthlyLimit : null,
          warningThresholds: (policy?.warningThresholds as number[] | undefined) ?? [50, 75, 90],
        },
      };
    });
    return Response.json(data);
  } catch (error) { return readFail(error); }
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
      await assertOrgCapability(client, orgId, "manage_api_keys");
      let before: unknown;
      if (body.scope === "org") {
        before = (await client.query("SELECT * FROM org_api_budget_policies WHERE org_id=$1", [orgId])).rows[0] ?? null;
        await client.query(`INSERT INTO org_api_budget_policies(org_id,daily_spend_limit_usd,
          monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,warning_thresholds,
          enforce_byo_token_limits,model_allowlist_enabled,provider_allowlist_enabled,kill_switch,prompt_caching_enabled,updated_by)
          VALUES($1,$2,$3,$4,$5,$6::integer[],$7,$8,$9,$10,$11,$12) ON CONFLICT(org_id) DO UPDATE SET
          daily_spend_limit_usd=excluded.daily_spend_limit_usd,monthly_spend_limit_usd=excluded.monthly_spend_limit_usd,
          daily_token_limit=excluded.daily_token_limit,monthly_token_limit=excluded.monthly_token_limit,
          warning_thresholds=excluded.warning_thresholds,enforce_byo_token_limits=excluded.enforce_byo_token_limits,
          model_allowlist_enabled=excluded.model_allowlist_enabled,provider_allowlist_enabled=excluded.provider_allowlist_enabled,
          kill_switch=excluded.kill_switch,prompt_caching_enabled=excluded.prompt_caching_enabled,
          updated_by=excluded.updated_by,updated_at=now()`,
          [orgId,...limits(body),thresholds,body.enforceByoTokenLimits !== false,Boolean(body.modelAllowlistEnabled),
            // Prompt caching is default-ON (migration 0448): an omitted field keeps
            // it on; only an explicit false turns it off.
            Boolean(body.providerAllowlistEnabled),Boolean(body.killSwitch),body.promptCachingEnabled !== false,current.user.id]);
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
        } else if (body.scope === "member") {
          // aiBlocked turns AI off for this person entirely (0730), limits or not.
          await client.query(`INSERT INTO org_api_member_limits(org_id,user_id,daily_spend_limit_usd,
            monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,ai_blocked,updated_by)
            VALUES($1::uuid,$2::uuid,$3::numeric,$4::numeric,$5::integer,$6::integer,$7::boolean,$8::uuid)
            ON CONFLICT(org_id,user_id) DO UPDATE SET daily_spend_limit_usd=excluded.daily_spend_limit_usd,
            monthly_spend_limit_usd=excluded.monthly_spend_limit_usd,daily_token_limit=excluded.daily_token_limit,
            monthly_token_limit=excluded.monthly_token_limit,ai_blocked=excluded.ai_blocked,
            updated_by=excluded.updated_by,updated_at=now()`,
            [orgId,...identity,...limits(body),body.aiBlocked === true,current.user.id]);
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
