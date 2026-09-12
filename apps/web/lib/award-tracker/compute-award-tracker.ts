import type { PoolClient } from "@neondatabase/serverless";
import {
  loadMediaEvidenceReferences,
  type MediaEvidenceReference,
} from "../media/evidence-references";
import { summarizeAwardTracker, upcomingDeadlines } from ".";
import type { AwardSubmission, AwardSubmissionStatus, AwardTrackerSummary, AwardType } from "./types";

export type AwardTrackerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AwardTrackerView =
  | {
      status: "setup_required";
      message: string;
      steps: AwardTrackerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      submissions: AwardSubmission[];
      upcoming: AwardSubmission[];
      summary: AwardTrackerSummary;
      evidenceLibrary: MediaEvidenceReference[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type SubmissionRow = {
  id: string;
  awardType: AwardType;
  awardName: string;
  eventName: string;
  eventDate: string | null;
  submissionDeadline: string | null;
  status: AwardSubmissionStatus;
  submittedOn: string | null;
  ownerNote: string | null;
  notes: string | null;
  seasonYear: number;
};

function mapSubmission(row: SubmissionRow): AwardSubmission {
  return {
    id: row.id,
    awardType: row.awardType,
    awardName: row.awardName,
    eventName: row.eventName,
    eventDate: row.eventDate,
    submissionDeadline: row.submissionDeadline,
    status: row.status,
    submittedOn: row.submittedOn,
    ownerNote: row.ownerNote,
    notes: row.notes,
    seasonYear: row.seasonYear,
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

export async function computeAwardTrackerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<AwardTrackerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track award submissions and deadlines.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [submissionResult, seasonResult, evidenceLibrary] = await Promise.all([
    client.query<SubmissionRow>(
      `SELECT id, award_type AS "awardType", award_name AS "awardName", event_name AS "eventName",
              event_date::text AS "eventDate", submission_deadline::text AS "submissionDeadline",
              status, submitted_on::text AS "submittedOn", owner_note AS "ownerNote", notes,
              season_year AS "seasonYear"
       FROM award_tracker_submissions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY submission_deadline ASC NULLS LAST, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM award_tracker_submissions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    loadMediaEvidenceReferences(client, { orgId: org.orgId }),
  ]);

  const submissions = submissionResult.rows.map(mapSubmission);
  const summary = summarizeAwardTracker(submissions);
  const upcoming = upcomingDeadlines(submissions).slice(0, 8);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    submissions,
    upcoming,
    summary,
    evidenceLibrary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createSubmission(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    awardType: AwardType;
    awardName: string;
    eventName: string;
    eventDate: string | null;
    submissionDeadline: string | null;
    status: AwardSubmissionStatus;
    submittedOn: string | null;
    ownerNote: string | null;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO award_tracker_submissions (
       org_id, award_type, award_name, event_name, event_date, submission_deadline,
       status, submitted_on, owner_note, notes, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8::date,$9,$10,$11,$12)`,
    [
      input.orgId,
      input.awardType,
      input.awardName,
      input.eventName,
      input.eventDate,
      input.submissionDeadline,
      input.status,
      input.submittedOn,
      input.ownerNote,
      input.notes,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateSubmissionStatus(
  client: PoolClient,
  input: { orgId: string; submissionId: string; status: AwardSubmissionStatus; submittedOn: string | null },
): Promise<void> {
  await client.query(
    `UPDATE award_tracker_submissions
     SET status = $1, submitted_on = COALESCE($2::date, submitted_on), updated_at = now()
     WHERE id = $3 AND org_id = $4`,
    [input.status, input.submittedOn, input.submissionId, input.orgId],
  );
}

export async function deleteSubmission(
  client: PoolClient,
  input: { orgId: string; submissionId: string },
): Promise<void> {
  await client.query(`DELETE FROM award_tracker_submissions WHERE id = $1 AND org_id = $2`, [
    input.submissionId,
    input.orgId,
  ]);
}
