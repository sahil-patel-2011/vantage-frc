import type { PoolClient } from "@neondatabase/serverless";
import { computeMentorEngagement, summarizeMentorHours } from ".";
import type {
  MentorHoursCategory,
  MentorHoursEngagement,
  MentorHoursEntry,
  MentorHoursRole,
  MentorHoursSummary,
} from "./types";

export const MENTOR_HOURS_CATEGORIES: MentorHoursCategory[] = [
  "build",
  "strategy",
  "programming",
  "outreach",
  "administration",
  "competition",
  "training",
  "other",
];
export const MENTOR_HOURS_ROLES: MentorHoursRole[] = [
  "mentor",
  "professional_mentor",
  "alumni_mentor",
  "parent_volunteer",
  "other",
];

export type MentorHoursSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MentorHoursView =
  | {
      status: "setup_required";
      message: string;
      steps: MentorHoursSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      entries: MentorHoursEntry[];
      summary: MentorHoursSummary;
      engagement: MentorHoursEngagement;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type EntryRow = {
  id: string;
  mentorName: string;
  mentorUserId: string | null;
  role: MentorHoursRole;
  category: MentorHoursCategory;
  occurredOn: string;
  durationMinutes: number;
  seasonYear: number;
  notes: string | null;
};

function mapEntry(row: EntryRow): MentorHoursEntry {
  return {
    id: row.id,
    mentorName: row.mentorName,
    mentorUserId: row.mentorUserId,
    role: row.role,
    category: row.category,
    occurredOn: row.occurredOn,
    durationMinutes: Number(row.durationMinutes) || 0,
    seasonYear: row.seasonYear,
    notes: row.notes,
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

export async function computeMentorHoursView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MentorHoursView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to log mentor hours and engagement.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [entryResult, seasonResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, mentor_name AS "mentorName", mentor_user_id AS "mentorUserId", role, category,
              occurred_on::text AS "occurredOn", duration_minutes AS "durationMinutes",
              season_year AS "seasonYear", notes
       FROM mentor_hours_entries
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM mentor_hours_entries WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const entries = entryResult.rows.map(mapEntry);
  const summary = summarizeMentorHours(entries);
  const engagement = computeMentorEngagement(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    entries,
    summary,
    engagement,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    mentorName: string;
    role: MentorHoursRole;
    category: MentorHoursCategory;
    occurredOn: string;
    durationMinutes: number;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO mentor_hours_entries (
       org_id, mentor_name, role, category, occurred_on, duration_minutes, notes, season_year, logged_by
     ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.mentorName,
      input.role,
      input.category,
      input.occurredOn,
      Math.max(0, Math.round(input.durationMinutes)),
      input.notes,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM mentor_hours_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
