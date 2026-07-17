import type { PoolClient } from "@neondatabase/serverless";
import { computeImpactReadiness, summarizeImpact } from ".";
import type {
  ImpactActivity,
  ImpactAudience,
  ImpactAwardTag,
  ImpactCategory,
  ImpactReadiness,
  ImpactSummary,
} from "./types";

export const IMPACT_CATEGORIES: ImpactCategory[] = [
  "stem_demo",
  "mentoring",
  "community_event",
  "competition",
  "media",
  "sustainability",
  "other",
];
export const IMPACT_AUDIENCES: ImpactAudience[] = [
  "k12",
  "college",
  "public",
  "industry",
  "other_teams",
  "internal",
  "other",
];
export const IMPACT_AWARD_TAGS: ImpactAwardTag[] = ["impact", "engineering_inspiration", "rookie_all_star"];

export type ImpactSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ImpactView =
  | {
      status: "setup_required";
      message: string;
      steps: ImpactSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      activities: ImpactActivity[];
      summary: ImpactSummary;
      readiness: ImpactReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ActivityRow = {
  id: string;
  title: string;
  category: ImpactCategory;
  occurredOn: string;
  durationMinutes: number;
  participantCount: number;
  peopleReached: number;
  audience: ImpactAudience;
  location: string | null;
  seasonYear: number;
  description: string | null;
  evidenceAwards: string[] | null;
};

function mapActivity(row: ActivityRow): ImpactActivity {
  const evidenceAwards = Array.isArray(row.evidenceAwards)
    ? row.evidenceAwards.filter((tag): tag is ImpactAwardTag => (IMPACT_AWARD_TAGS as string[]).includes(tag))
    : [];
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    occurredOn: row.occurredOn,
    durationMinutes: Number(row.durationMinutes) || 0,
    participantCount: Number(row.participantCount) || 0,
    peopleReached: Number(row.peopleReached) || 0,
    audience: row.audience,
    location: row.location,
    seasonYear: row.seasonYear,
    description: row.description,
    evidenceAwards,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeImpactView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ImpactView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to log community impact and outreach.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [activityResult, seasonResult] = await Promise.all([
    client.query<ActivityRow>(
      `SELECT id, title, category, occurred_on::text AS "occurredOn",
              duration_minutes AS "durationMinutes", participant_count AS "participantCount",
              people_reached AS "peopleReached", audience, location, season_year AS "seasonYear",
              description, evidence_awards AS "evidenceAwards"
       FROM impact_activities
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM impact_activities WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const activities = activityResult.rows.map(mapActivity);
  const summary = summarizeImpact(activities);
  const readiness = computeImpactReadiness(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    activities,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logActivity(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    category: ImpactCategory;
    occurredOn: string;
    durationMinutes: number;
    participantCount: number;
    peopleReached: number;
    audience: ImpactAudience;
    location: string | null;
    description: string | null;
    seasonYear: number;
    evidenceAwards: ImpactAwardTag[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO impact_activities (
       org_id, title, category, occurred_on, duration_minutes, participant_count,
       people_reached, audience, location, description, season_year, evidence_awards, logged_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13)`,
    [
      input.orgId,
      input.title,
      input.category,
      input.occurredOn,
      Math.max(0, Math.round(input.durationMinutes)),
      Math.max(0, Math.round(input.participantCount)),
      Math.max(0, Math.round(input.peopleReached)),
      input.audience,
      input.location,
      input.description,
      input.seasonYear,
      input.evidenceAwards,
      input.userId,
    ],
  );
}

export async function deleteActivity(
  client: PoolClient,
  input: { orgId: string; activityId: string },
): Promise<void> {
  await client.query(`DELETE FROM impact_activities WHERE id = $1 AND org_id = $2`, [
    input.activityId,
    input.orgId,
  ]);
}
