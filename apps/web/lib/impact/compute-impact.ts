import type { PoolClient } from "@neondatabase/serverless";
import { computeImpactReadiness, summarizeImpact } from ".";
import { summarizePeople } from "./participants";
import type {
  ImpactActivity,
  ImpactAudience,
  ImpactAwardTag,
  ImpactCategory,
  ImpactParticipant,
  ImpactReadiness,
  PersonOutreachTotal,
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
      /** Per-person outreach from named participation — empty until someone is named. */
      people: PersonOutreachTotal[];
      /** Everyone on the team, for the "who helped" picker. */
      members: Array<{ userId: string; name: string }>;
      currentUserId: string;
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

function mapActivity(row: ActivityRow, participants: ImpactParticipant[] = []): ImpactActivity {
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
    participants,
  };
}

type ParticipantRow = {
  activityId: string;
  userId: string;
  name: string;
  minutes: number | null;
  role: string | null;
};

/** Named participants for a set of activities, grouped by activity. */
async function loadParticipants(
  client: PoolClient,
  orgId: string,
  activityIds: string[],
): Promise<Map<string, ImpactParticipant[]>> {
  const byActivity = new Map<string, ImpactParticipant[]>();
  if (activityIds.length === 0) return byActivity;
  const rows = await client.query<ParticipantRow>(
    `SELECT p.activity_id AS "activityId", p.user_id AS "userId", u.name, p.minutes, p.role
       FROM impact_activity_participants p
       JOIN users u ON u.id = p.user_id
      WHERE p.org_id = $1::uuid AND p.activity_id = ANY($2::uuid[])
      ORDER BY lower(u.name), u.id`,
    [orgId, activityIds],
  );
  for (const row of rows.rows) {
    const list = byActivity.get(row.activityId) ?? [];
    list.push({
      userId: row.userId,
      name: row.name,
      minutes: row.minutes == null ? null : Number(row.minutes),
      role: row.role,
    });
    byActivity.set(row.activityId, list);
  }
  return byActivity;
}

async function loadMembers(
  client: PoolClient,
  orgId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const rows = await client.query<{ userId: string; name: string }>(
    `SELECT u.id AS "userId", u.name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid
      ORDER BY lower(u.name), u.id`,
    [orgId],
  );
  return rows.rows;
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
      message: "Choose your team to log community impact and outreach.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
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

  const [participants, members] = await Promise.all([
    loadParticipants(client, org.orgId, activityResult.rows.map((r) => r.id)),
    loadMembers(client, org.orgId),
  ]);
  const activities = activityResult.rows.map((row) => mapActivity(row, participants.get(row.id) ?? []));
  const summary = summarizeImpact(activities);
  const people = summarizePeople(activities);
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
    people,
    members,
    currentUserId: input.userId,
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
): Promise<{ activityId: string }> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO impact_activities (
       org_id, title, category, occurred_on, duration_minutes, participant_count,
       people_reached, audience, location, description, season_year, evidence_awards, logged_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13)
     RETURNING id`,
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
  return { activityId: inserted.rows[0]!.id };
}

/**
 * Name the people who were at an activity. Upserts by (activity, user) so
 * re-submitting the same list corrects minutes instead of failing on the
 * unique constraint. The RLS policy — not this code — refuses a user id from
 * another team and an activity from another org.
 */
export async function setParticipants(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    activityId: string;
    participants: Array<{ userId: string; minutes: number | null; role: string | null }>;
  },
): Promise<void> {
  for (const p of input.participants) {
    await client.query(
      `INSERT INTO impact_activity_participants (org_id, activity_id, user_id, minutes, role, added_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int, $5, $6::uuid)
       ON CONFLICT (activity_id, user_id)
       DO UPDATE SET minutes = EXCLUDED.minutes, role = EXCLUDED.role`,
      [input.orgId, input.activityId, p.userId, p.minutes, p.role, input.userId],
    );
  }
}

export async function removeParticipant(
  client: PoolClient,
  input: { orgId: string; activityId: string; userId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM impact_activity_participants
      WHERE org_id = $1::uuid AND activity_id = $2::uuid AND user_id = $3::uuid`,
    [input.orgId, input.activityId, input.userId],
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
