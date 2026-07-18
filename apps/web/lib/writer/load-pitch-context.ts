// Loads THIS org's writer profile + business facts under the caller's withRls
// transaction. Every query filters by org_id = $1 — never other organizations.

import type { PoolClient } from "@neondatabase/serverless";
import type { PitchBusinessFacts } from "./ai-pitch";
import type { WriterProfile, WriterTone } from "./types";

type ProfileRow = {
  teamName: string | null;
  teamNumber: number | null;
  region: string | null;
  mission: string | null;
  achievements: unknown;
  fundingNeed: string | null;
  fundingAskUsd: string | number | null;
  tone: WriterTone | null;
};

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function loadOrgPitchContext(
  client: PoolClient,
  input: {
    orgId: string;
    seasonYear: number;
    orgName: string | null;
    teamNumber: number | null;
  },
): Promise<{ profile: WriterProfile; business: PitchBusinessFacts }> {
  const { orgId, seasonYear } = input;

  const [
    profileResult,
    impactResult,
    goalsResult,
    awardsResult,
    financeResult,
    incomeResult,
    sponsorCountResult,
  ] = await Promise.all([
      client.query<ProfileRow>(
        `SELECT team_name AS "teamName", team_number AS "teamNumber", region, mission, achievements,
                funding_need AS "fundingNeed", funding_ask_usd AS "fundingAskUsd", tone
         FROM writer_profile WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ activities: string; minutes: string; peopleReached: string }>(
        `SELECT COUNT(*)::text AS activities, COALESCE(SUM(duration_minutes), 0)::text AS minutes,
                COALESCE(SUM(people_reached), 0)::text AS "peopleReached"
         FROM impact_activities WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{
        title: string;
        category: string;
        currentValue: string | number;
        targetValue: string | number;
        unit: string | null;
      }>(
        `SELECT title, category,
                current_value AS "currentValue", target_value AS "targetValue", unit
         FROM season_goals
         WHERE org_id = $1 AND season_year = $2
         ORDER BY
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           created_at
         LIMIT 12`,
        [orgId, seasonYear],
      ),
      client.query<{ awardName: string; eventName: string | null; seasonYear: number }>(
        `SELECT award_type AS "awardName", COALESCE(event_name, event_key) AS "eventName",
                season_year AS "seasonYear"
         FROM award_submissions
         WHERE org_id = $1 AND status = 'won'
         ORDER BY season_year DESC, award_type
         LIMIT 8`,
        [orgId],
      ),
      client.query<{ fundraisingGoalUsd: string | null }>(
        `SELECT fundraising_goal_usd::text AS "fundraisingGoalUsd"
         FROM finance_season_settings WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ seasonUsd: string }>(
        `SELECT COALESCE(SUM(COALESCE(amount_usd, estimated_value_usd, 0)), 0)::text AS "seasonUsd"
         FROM sponsor_contributions
         WHERE org_id = $1 AND season_year = $2`,
        [orgId, seasonYear],
      ),
      client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sponsors WHERE org_id = $1 AND status = 'active'`,
        [orgId],
      ),
    ]);

  const row = profileResult.rows[0];
  const profile: WriterProfile = {
    teamName: row?.teamName ?? input.orgName ?? (input.teamNumber ? `Team ${input.teamNumber}` : "Our team"),
    teamNumber: row?.teamNumber ?? input.teamNumber ?? null,
    region: row?.region ?? null,
    mission: row?.mission ?? null,
    achievements: coerceStrings(row?.achievements),
    fundingNeed: row?.fundingNeed ?? null,
    fundingAskUsd: row ? num(row.fundingAskUsd) : null,
    tone: row?.tone ?? "warm",
  };

  const impactRow = impactResult.rows[0];
  const activities = Number(impactRow?.activities ?? 0);
  const minutes = Number(impactRow?.minutes ?? 0);
  const peopleReached = Number(impactRow?.peopleReached ?? 0);
  const communityHours = Math.round((minutes / 60) * 10) / 10;
  const impact =
    activities > 0
      ? {
          activities,
          hours: communityHours,
          peopleReached,
        }
      : null;

  const seasonGoals = goalsResult.rows.map((row) => {
    const currentValue = Number(row.currentValue) || 0;
    const targetValue = Number(row.targetValue) || 0;
    const progress =
      targetValue > 0 ? Math.min(1, Math.max(0, currentValue / targetValue)) : currentValue > 0 ? 1 : 0;
    return {
      title: row.title,
      category: row.category,
      currentValue,
      targetValue,
      unit: row.unit,
      progress,
    };
  });

  const business: PitchBusinessFacts = {
    orgId,
    seasonYear,
    impact,
    communityHours: communityHours > 0 ? communityHours : null,
    seasonGoals,
    awards: awardsResult.rows,
    fundraisingGoalUsd: num(financeResult.rows[0]?.fundraisingGoalUsd),
    seasonSponsorIncomeUsd: num(incomeResult.rows[0]?.seasonUsd),
    activeSponsorCount: sponsorCountResult.rows[0]?.count ?? 0,
  };

  return { profile, business };
}
