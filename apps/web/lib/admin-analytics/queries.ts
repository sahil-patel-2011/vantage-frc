import type { PoolClient } from "@neondatabase/serverless";
import {
  activeOrgIds,
  aiDailySeries,
  aiTotalsByGroup,
  daysActiveByOrg,
  daysActiveHistogram,
  dayBefore,
  fillDailySeries,
  lastActiveByOrg,
  roundMoney,
  safeCount,
  safeMoney,
  sumEventsByDay,
  sumEventsBySource,
  topSourceByOrg,
  utcDay,
  type ActivityRow,
  type AiDailyRow,
} from "./compute";

/**
 * Cross-org read layer for the platform-owner cockpit. Callers MUST have run
 * assertPlatformAdmin(client) first — these queries lean on the platform RLS
 * policies (organizations/memberships/ai_usage_events platform reads) and the
 * count-only SECURITY DEFINER functions from migration 0479, which themselves
 * fail closed for non-admins. Every number comes from real rows; an empty
 * platform legitimately reports zeros.
 */

export const ANALYTICS_WINDOW_DAYS = 60;

export type PlatformAnalytics = {
  window: { start: string; end: string; days: number };
  totals: {
    orgs: number;
    orgsActive7d: number;
    orgsActive30d: number;
    members: number;
    membersActive7d: number;
    membersActive30d: number;
    aiCalls: number;
    aiTokens: number;
    aiCostUsd: number;
  };
  activity: {
    perDay: Array<{ day: string; value: number }>;
    bySource: Array<{ source: string; events: number }>;
    histogram: Array<{ label: string; orgs: number }>;
  };
  ai: {
    perDay: Array<{ day: string; calls: number; tokens: number; costUsd: number }>;
    byGroup: Array<{ group: string; calls: number; tokens: number; costUsd: number }>;
    byModel: Array<{ provider: string; model: string; calls: number; tokens: number; costUsd: number }>;
    byFeature: Array<{ feature: string; calls: number; tokens: number; costUsd: number }>;
  };
  orgs: Array<PlatformOrgSummary>;
};

export type PlatformOrgSummary = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number | null;
  createdAt: string;
  members: number;
  activeMembers30d: number;
  lastActiveDay: string | null;
  daysActive: number;
  topSource: string | null;
  aiCalls: number;
  aiCostUsd: number;
  topAiFeature: string | null;
};

export type PlatformOrgDrilldown = {
  window: { start: string; end: string; days: number };
  org: PlatformOrgSummary;
  activity: {
    perDay: Array<{ day: string; value: number }>;
    bySource: Array<{ source: string; events: number }>;
  };
  ai: {
    perDay: Array<{ day: string; calls: number; tokens: number; costUsd: number }>;
    byGroup: Array<{ group: string; calls: number; tokens: number; costUsd: number }>;
    byFeature: Array<{ feature: string; calls: number; tokens: number; costUsd: number }>;
  };
};

async function readActivity(
  client: PoolClient,
  sinceDay: string,
  orgId?: string,
): Promise<ActivityRow[]> {
  const result = await client.query<{ orgId: string; day: string; source: string; events: string }>(
    `SELECT org_id AS "orgId", day::text AS day, source, events::text AS events
     FROM platform_activity_daily($1::date, $2::uuid)`,
    [sinceDay, orgId ?? null],
  );
  return result.rows.map((row) => ({
    orgId: row.orgId,
    day: row.day,
    source: row.source,
    events: safeCount(row.events),
  }));
}

async function readAiDaily(
  client: PoolClient,
  sinceDay: string,
  orgId?: string,
): Promise<AiDailyRow[]> {
  const result = await client.query<{
    day: string;
    keySource: string;
    calls: string;
    tokens: string;
    costUsd: string;
  }>(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
            key_source::text AS "keySource",
            count(*)::text AS calls,
            COALESCE(sum(total_tokens),0)::text AS tokens,
            COALESCE(sum(cost_usd),0)::text AS "costUsd"
     FROM ai_usage_events
     WHERE created_at >= $1::date AND ($2::uuid IS NULL OR org_id = $2::uuid)
     GROUP BY 1, 2`,
    [sinceDay, orgId ?? null],
  );
  return result.rows.map((row) => ({
    day: row.day,
    keySource: row.keySource,
    calls: safeCount(row.calls),
    tokens: safeCount(row.tokens),
    costUsd: safeMoney(row.costUsd),
  }));
}

async function readAiByModel(client: PoolClient, sinceDay: string, orgId?: string) {
  const result = await client.query<{
    provider: string;
    model: string;
    calls: string;
    tokens: string;
    costUsd: string;
  }>(
    `SELECT provider, model, count(*)::text AS calls,
            COALESCE(sum(total_tokens),0)::text AS tokens,
            COALESCE(sum(cost_usd),0)::text AS "costUsd"
     FROM ai_usage_events
     WHERE created_at >= $1::date AND ($2::uuid IS NULL OR org_id = $2::uuid)
     GROUP BY provider, model
     ORDER BY sum(cost_usd) DESC, count(*) DESC
     LIMIT 20`,
    [sinceDay, orgId ?? null],
  );
  return result.rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    calls: safeCount(row.calls),
    tokens: safeCount(row.tokens),
    costUsd: roundMoney(safeMoney(row.costUsd)),
  }));
}

async function readAiByFeature(client: PoolClient, sinceDay: string, orgId?: string) {
  const result = await client.query<{ feature: string; calls: string; tokens: string; costUsd: string }>(
    `SELECT feature, count(*)::text AS calls,
            COALESCE(sum(total_tokens),0)::text AS tokens,
            COALESCE(sum(cost_usd),0)::text AS "costUsd"
     FROM ai_usage_events
     WHERE created_at >= $1::date AND ($2::uuid IS NULL OR org_id = $2::uuid)
     GROUP BY feature
     ORDER BY count(*) DESC
     LIMIT 20`,
    [sinceDay, orgId ?? null],
  );
  return result.rows.map((row) => ({
    feature: row.feature,
    calls: safeCount(row.calls),
    tokens: safeCount(row.tokens),
    costUsd: roundMoney(safeMoney(row.costUsd)),
  }));
}

async function readActiveMembers(
  client: PoolClient,
  sinceIso: string,
): Promise<{ total: number; byOrg: Map<string, number> }> {
  const result = await client.query<{ orgId: string | null; activeMembers: string }>(
    `SELECT org_id AS "orgId", active_members::text AS "activeMembers"
     FROM platform_active_members($1::timestamptz)`,
    [sinceIso],
  );
  const byOrg = new Map<string, number>();
  let total = 0;
  for (const row of result.rows) {
    if (row.orgId === null) total = safeCount(row.activeMembers);
    else byOrg.set(row.orgId, safeCount(row.activeMembers));
  }
  return { total, byOrg };
}

type OrgBaseRow = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number | null;
  createdAt: string;
  members: string;
  aiCalls: string;
  aiCostUsd: string;
  topAiFeature: string | null;
};

async function readOrgBase(client: PoolClient, sinceDay: string, orgId?: string): Promise<OrgBaseRow[]> {
  const result = await client.query<OrgBaseRow>(
    `SELECT o.id, o.name, o.slug, o.team_number AS "teamNumber", o.created_at::text AS "createdAt",
            COALESCE(mc.members, 0)::text AS members,
            COALESCE(ai.calls, 0)::text AS "aiCalls",
            COALESCE(ai.cost_usd, 0)::text AS "aiCostUsd",
            ai.top_feature AS "topAiFeature"
     FROM organizations o
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT m.user_id) AS members FROM memberships m WHERE m.org_id = o.id
     ) mc ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS calls,
              COALESCE(sum(e.cost_usd), 0) AS cost_usd,
              (SELECT f.feature FROM ai_usage_events f
                WHERE f.org_id = o.id AND f.created_at >= $1::date
                GROUP BY f.feature ORDER BY count(*) DESC LIMIT 1) AS top_feature
       FROM ai_usage_events e
       WHERE e.org_id = o.id AND e.created_at >= $1::date
     ) ai ON true
     WHERE $2::uuid IS NULL OR o.id = $2::uuid
     ORDER BY o.team_number NULLS LAST, o.created_at`,
    [sinceDay, orgId ?? null],
  );
  return result.rows;
}

function orgSummaries(
  base: OrgBaseRow[],
  activity: ActivityRow[],
  activeMembers30: Map<string, number>,
): PlatformOrgSummary[] {
  const daysActive = daysActiveByOrg(activity);
  const lastActive = lastActiveByOrg(activity);
  const topSource = topSourceByOrg(activity);
  return base.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    teamNumber: org.teamNumber,
    createdAt: org.createdAt,
    members: safeCount(org.members),
    activeMembers30d: activeMembers30.get(org.id) ?? 0,
    lastActiveDay: lastActive.get(org.id) ?? null,
    daysActive: daysActive.get(org.id) ?? 0,
    topSource: topSource.get(org.id) ?? null,
    aiCalls: safeCount(org.aiCalls),
    aiCostUsd: roundMoney(safeMoney(org.aiCostUsd)),
    topAiFeature: org.topAiFeature,
  }));
}

/** The whole /admin/analytics overview payload — real rows only. */
export async function computePlatformAnalytics(
  client: PoolClient,
  now: Date = new Date(),
): Promise<PlatformAnalytics> {
  const end = utcDay(now);
  const start = dayBefore(end, ANALYTICS_WINDOW_DAYS - 1);
  const since7 = dayBefore(end, 6);
  const since30 = dayBefore(end, 29);

  const [activity, aiRows, byModel, byFeature, members7, members30, orgBase, memberTotal] =
    await Promise.all([
      readActivity(client, start),
      readAiDaily(client, start),
      readAiByModel(client, start),
      readAiByFeature(client, start),
      readActiveMembers(client, `${since7}T00:00:00.000Z`),
      readActiveMembers(client, `${since30}T00:00:00.000Z`),
      readOrgBase(client, start),
      client.query<{ members: string }>(
        `SELECT count(DISTINCT user_id)::text AS members FROM memberships`,
      ),
    ]);

  const orgs = orgSummaries(orgBase, activity, members30.byOrg);
  const aiPerDay = aiDailySeries(aiRows, end, ANALYTICS_WINDOW_DAYS);
  const aiGroups = aiTotalsByGroup(aiRows);

  return {
    window: { start, end, days: ANALYTICS_WINDOW_DAYS },
    totals: {
      orgs: orgs.length,
      orgsActive7d: activeOrgIds(activity, since7).size,
      orgsActive30d: activeOrgIds(activity, since30).size,
      members: safeCount(memberTotal.rows[0]?.members),
      membersActive7d: members7.total,
      membersActive30d: members30.total,
      aiCalls: aiGroups.reduce((sum, group) => sum + group.calls, 0),
      aiTokens: aiGroups.reduce((sum, group) => sum + group.tokens, 0),
      aiCostUsd: roundMoney(aiGroups.reduce((sum, group) => sum + group.costUsd, 0)),
    },
    activity: {
      perDay: fillDailySeries(sumEventsByDay(activity), end, ANALYTICS_WINDOW_DAYS),
      bySource: sumEventsBySource(activity),
      histogram: daysActiveHistogram(
        orgs.map((org) => org.daysActive),
        orgs.length,
      ),
    },
    ai: { perDay: aiPerDay, byGroup: aiGroups, byModel, byFeature },
    orgs,
  };
}

/** One org's drilldown, or null when the id does not exist. */
export async function computeOrgDrilldown(
  client: PoolClient,
  orgId: string,
  now: Date = new Date(),
): Promise<PlatformOrgDrilldown | null> {
  const end = utcDay(now);
  const start = dayBefore(end, ANALYTICS_WINDOW_DAYS - 1);
  const since30 = dayBefore(end, 29);

  const [orgBase, activity, aiRows, byFeature, members30] = await Promise.all([
    readOrgBase(client, start, orgId),
    readActivity(client, start, orgId),
    readAiDaily(client, start, orgId),
    readAiByFeature(client, start, orgId),
    readActiveMembers(client, `${since30}T00:00:00.000Z`),
  ]);
  const base = orgBase[0];
  if (!base) return null;

  const [org] = orgSummaries(orgBase, activity, members30.byOrg);
  return {
    window: { start, end, days: ANALYTICS_WINDOW_DAYS },
    org: org!,
    activity: {
      perDay: fillDailySeries(sumEventsByDay(activity), end, ANALYTICS_WINDOW_DAYS),
      bySource: sumEventsBySource(activity),
    },
    ai: {
      perDay: aiDailySeries(aiRows, end, ANALYTICS_WINDOW_DAYS),
      byGroup: aiTotalsByGroup(aiRows),
      byFeature,
    },
  };
}
