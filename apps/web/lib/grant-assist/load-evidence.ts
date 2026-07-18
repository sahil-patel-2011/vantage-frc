import type { PoolClient } from "@neondatabase/serverless";
import type { GrantOrgEvidence, GrantProvenanceItem, GrantSeasonGoal } from "./types";

function num(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function goalProgress(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return current > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, current / target));
}

function formatLocation(city: string | null, stateProv: string | null): string | null {
  const c = city?.trim() || "";
  const s = stateProv?.trim() || "";
  if (c && s) return `${c}, ${s}`;
  return c || s || null;
}

export async function loadGrantOrgEvidence(
  client: PoolClient,
  input: { orgId: string; seasonYear: number },
): Promise<GrantOrgEvidence | null> {
  const { orgId, seasonYear } = input;
  const org = await client.query<{
    orgName: string;
    teamNumber: number | null;
    city: string | null;
    stateProv: string | null;
    description: string | null;
  }>(
    `SELECT o.name AS "orgName", o.team_number AS "teamNumber",
            o.city, o.state_prov AS "stateProv", o.description
     FROM organizations o WHERE o.id = $1`,
    [orgId],
  );
  if (!org.rowCount) return null;

  const [impactResult, goalsResult, awardsResult] = await Promise.all([
    client.query<{ activities: string; minutes: string; peopleReached: string }>(
      `SELECT COUNT(*)::text AS activities,
              COALESCE(SUM(duration_minutes), 0)::text AS minutes,
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
      `SELECT title, category, current_value AS "currentValue", target_value AS "targetValue", unit
       FROM season_goals WHERE org_id = $1 AND season_year = $2
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at
       LIMIT 12`,
      [orgId, seasonYear],
    ),
    client.query<{
      awardName: string;
      eventName: string | null;
      seasonYear: number;
      sourceUrl: string | null;
    }>(
      `SELECT award_type AS "awardName", COALESCE(event_name, event_key) AS "eventName",
              season_year AS "seasonYear", source_url AS "sourceUrl"
       FROM award_submissions WHERE org_id = $1 AND status = 'won'
       ORDER BY season_year DESC, award_type LIMIT 8`,
      [orgId],
    ),
  ]);

  const impactRow = impactResult.rows[0];
  const activities = num(impactRow?.activities);
  const minutes = num(impactRow?.minutes);
  const peopleReached = num(impactRow?.peopleReached);
  const communityHours = Math.round((minutes / 60) * 10) / 10;
  const seasonGoals: GrantSeasonGoal[] = goalsResult.rows.map((row) => {
    const currentValue = num(row.currentValue);
    const targetValue = num(row.targetValue);
    return {
      title: row.title,
      category: row.category,
      currentValue,
      targetValue,
      unit: row.unit,
      progress: goalProgress(currentValue, targetValue),
    };
  });
  const orgRow = org.rows[0]!;
  return {
    orgId,
    orgName: orgRow.orgName,
    teamNumber: orgRow.teamNumber,
    city: orgRow.city,
    stateProv: orgRow.stateProv,
    description: orgRow.description,
    location: formatLocation(orgRow.city, orgRow.stateProv),
    seasonYear,
    impact: { activities, hours: communityHours, peopleReached },
    communityHours,
    seasonGoals,
    awards: awardsResult.rows,
  };
}

export function provenanceFromEvidence(evidence: GrantOrgEvidence): GrantProvenanceItem[] {
  const items: GrantProvenanceItem[] = [];
  if (evidence.location) {
    items.push({
      label: "Team location",
      value: evidence.location,
      source: "Org onboarding profile (this org)",
      kind: "org",
    });
  }
  if (evidence.impact.activities > 0) {
    items.push({
      label: "Community impact",
      value: `${evidence.impact.activities} activities · ${evidence.communityHours} hours · ${evidence.impact.peopleReached.toLocaleString()} people`,
      source: "Community Impact log (this org)",
      kind: "impact",
    });
  }
  if (evidence.communityHours > 0) {
    items.push({
      label: "Community hours",
      value: `${evidence.communityHours} service hours`,
      source: "Community Impact log (this org)",
      kind: "impact",
    });
  }
  for (const goal of evidence.seasonGoals.slice(0, 6)) {
    const unit = goal.unit ? ` ${goal.unit}` : "";
    items.push({
      label: `Season goal: ${goal.title}`,
      value: `${goal.currentValue}${unit} of ${goal.targetValue}${unit} (${Math.round(goal.progress * 100)}%)`,
      source: "Season goals (this org)",
      kind: "goal",
    });
  }
  for (const award of evidence.awards.slice(0, 5)) {
    items.push({
      label: award.awardName,
      value: `${award.eventName ?? "Team record"}, ${award.seasonYear}`,
      source: award.sourceUrl ?? "Awards workbench (this org)",
      kind: "award",
    });
  }
  return items;
}

export function evidenceSnippet(evidence: GrantOrgEvidence): string {
  const parts: string[] = [];
  if (evidence.impact.activities > 0) {
    parts.push(
      `Impact: ${evidence.impact.activities} activities, ${evidence.communityHours} community hours, ${evidence.impact.peopleReached.toLocaleString()} people reached.`,
    );
  } else if (evidence.communityHours > 0) {
    parts.push(`Community hours: ${evidence.communityHours}.`);
  }
  for (const goal of evidence.seasonGoals.slice(0, 4)) {
    const unit = goal.unit ? ` ${goal.unit}` : "";
    parts.push(`Goal — ${goal.title}: ${goal.currentValue}${unit} / ${goal.targetValue}${unit}.`);
  }
  return parts.join("\n");
}
