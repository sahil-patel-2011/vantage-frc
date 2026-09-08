/**
 * One definition of "what this team has left, and what consumed it".
 *
 * `meteredAI` enforces the included allowance against `org_billing`: the cap is
 * `credit_cap_usd` and the window is `[period_start, period_end)`, summed over
 * `ai_usage_events.created_at`. Every surface that *shows* a team its allowance
 * has to use those same three things, or the number on screen is not the number
 * the enforcer will apply.
 *
 * Before this module `/api/billing/usage` answered the question a third way —
 * `pricing_plans.included_allowance_usd` reached through `org_entitlements`, over
 * a lifetime (unfiltered) sum of `ai_usage_events`. For a provisioned free team
 * that has no `org_entitlements` row — the normal state, since access is closed
 * and the platform admin seeds `org_billing`, not entitlements — that reported
 * `includedAllowanceUsd: 0` and `allowancePercent: null`, so the free allowance
 * was invisible in the product while `meteredAI` was happily enforcing it. Once a
 * team had used AI for more than a month, the lifetime sum also overstated
 * spend against a monthly cap and could never fall back down.
 *
 * Read-only: it runs inside the caller's `withRls` transaction as `vantage_app`,
 * so RLS still decides which org's rows are visible.
 */

import type { PoolClient } from "@neondatabase/serverless";

export type AllowanceFeatureSpend = {
  feature: string;
  calls: number;
  costUsd: number;
  tokens: number;
};

export type OrgAllowance = {
  /** Present only when the org has an `org_billing` row (platform admin provisions it). */
  configured: boolean;
  tier: "free" | "starter" | "team" | "enterprise" | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The cap `meteredAI` enforces for this period, in USD. */
  includedAllowanceUsd: number;
  /** Platform-billed spend inside the current period, in USD. */
  usedUsd: number;
  remainingUsd: number;
  /** null when there is no cap to be a percentage of. */
  percentUsed: number | null;
  killSwitch: boolean;
  /** What consumed the allowance this period, largest first. */
  byFeature: AllowanceFeatureSpend[];
};

const EMPTY: OrgAllowance = {
  configured: false,
  tier: null,
  periodStart: null,
  periodEnd: null,
  includedAllowanceUsd: 0,
  usedUsd: 0,
  remainingUsd: 0,
  percentUsed: null,
  killSwitch: false,
  byFeature: [],
};

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

/**
 * Read the current period's allowance exactly as `meteredAI` enforces it.
 *
 * Returns `configured: false` — never a fabricated cap — when the org has no
 * `org_billing` row, so callers can render a "billing not provisioned" state
 * instead of a made-up allowance.
 */
export async function readOrgAllowance(client: PoolClient, orgId: string): Promise<OrgAllowance> {
  const account = await client.query<{
    tier: "free" | "starter" | "team" | "enterprise";
    creditCapUsd: string;
    killSwitch: boolean;
    periodStart: string;
    periodEnd: string;
  }>(
    `SELECT tier,
            credit_cap_usd::text AS "creditCapUsd",
            kill_switch AS "killSwitch",
            period_start::text AS "periodStart",
            period_end::text AS "periodEnd"
       FROM org_billing
      WHERE org_id = $1::uuid`,
    [orgId],
  );
  const row = account.rows[0];
  if (!row) return EMPTY;

  // Same window and same column meteredAI sums over, so the two agree by construction.
  const spend = await client.query<{ feature: string; calls: string; cost: string; tokens: string }>(
    `SELECT feature,
            count(*)::text AS calls,
            COALESCE(sum(cost_usd), 0)::text AS cost,
            COALESCE(sum(total_tokens), 0)::text AS tokens
       FROM ai_usage_events
      WHERE org_id = $1::uuid
        AND created_at >= $2::timestamptz
        AND created_at < $3::timestamptz
      GROUP BY feature
      ORDER BY 3 DESC, feature`,
    [orgId, row.periodStart, row.periodEnd],
  );

  const byFeature = spend.rows.map((r) => ({
    feature: r.feature,
    calls: Number(r.calls) || 0,
    costUsd: money(r.cost),
    tokens: Number(r.tokens) || 0,
  }));
  const usedUsd = money(byFeature.reduce((sum, r) => sum + r.costUsd, 0));
  const includedAllowanceUsd = money(row.creditCapUsd);

  return {
    configured: true,
    tier: row.tier,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    includedAllowanceUsd,
    usedUsd,
    remainingUsd: money(Math.max(0, includedAllowanceUsd - usedUsd)),
    percentUsed:
      includedAllowanceUsd > 0 ? Math.round((usedUsd / includedAllowanceUsd) * 1000) / 10 : null,
    killSwitch: row.killSwitch === true,
    byFeature,
  };
}
