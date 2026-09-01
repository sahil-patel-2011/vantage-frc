import type { PoolClient } from "@neondatabase/serverless";
import { computeMentorEngagement, summarizeMentorHours } from ".";
import {
  deleteMentorHoursEntry,
  insertMentorHoursEntry,
  listMentorHoursEntries,
  listMentorHoursSeasons,
} from "./ledger";
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
      status: "empty";
      message: string;
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      computedAt: string;
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

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
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

  const [entries, seasonYears] = await Promise.all([
    listMentorHoursEntries(client, { orgId: org.orgId, seasonYear }),
    listMentorHoursSeasons(client, org.orgId),
  ]);

  const seasons = [...seasonYears];
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  if (entries.length === 0) {
    return {
      status: "empty",
      message: "No mentor or volunteer hours logged for this season yet.",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      seasons,
      computedAt: new Date().toISOString(),
    };
  }

  const summary = summarizeMentorHours(entries);
  const engagement = computeMentorEngagement(summary);

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
    mentorUserId?: string | null;
    role: MentorHoursRole;
    category: MentorHoursCategory;
    occurredOn: string;
    durationMinutes: number;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await insertMentorHoursEntry(client, input);
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await deleteMentorHoursEntry(client, input);
}
