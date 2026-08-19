import type { PoolClient } from "@neondatabase/serverless";
import { summarizeExitInterviews } from ".";
import {
  buildExitInterviewWikiBody,
  exitInterviewWikiSlug,
  exitInterviewWikiTitle,
} from "./wiki";
import type { ExitInterviewRecord, ExitInterviewRole, ExitInterviewStatus, ExitInterviewSummary } from "./types";

export const EXIT_INTERVIEW_ROLES: ExitInterviewRole[] = [
  "mechanical",
  "electrical",
  "programming",
  "strategy",
  "outreach",
  "leadership",
  "mentor",
  "other",
];
export const EXIT_INTERVIEW_STATUSES: ExitInterviewStatus[] = ["draft", "submitted"];

export type ExitInterviewSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ExitInterviewView =
  | {
      status: "setup_required";
      message: string;
      steps: ExitInterviewSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      records: ExitInterviewRecord[];
      summary: ExitInterviewSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RecordRow = {
  id: string;
  memberName: string;
  memberUserId: string | null;
  role: ExitInterviewRole;
  yearsOnTeam: number;
  graduationYear: number;
  seasonYear: number;
  highlights: string | null;
  adviceForFuture: string | null;
  skillsToDocument: string | null;
  willingToMentor: boolean;
  contactEmail: string | null;
  status: ExitInterviewStatus;
  knowledgePageId: string | null;
};

function mapRecord(row: RecordRow): ExitInterviewRecord {
  return {
    id: row.id,
    memberName: row.memberName,
    memberUserId: row.memberUserId,
    role: row.role,
    yearsOnTeam: Number(row.yearsOnTeam) || 0,
    graduationYear: Number(row.graduationYear) || currentSeasonYear(),
    seasonYear: Number(row.seasonYear) || currentSeasonYear(),
    highlights: row.highlights,
    adviceForFuture: row.adviceForFuture,
    skillsToDocument: row.skillsToDocument,
    willingToMentor: Boolean(row.willingToMentor),
    contactEmail: row.contactEmail,
    status: row.status,
    knowledgePageId: row.knowledgePageId,
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

export async function computeExitInterviewView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ExitInterviewView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to capture graduation exit interviews.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [recordResult, seasonResult] = await Promise.all([
    client.query<RecordRow>(
      `SELECT id, member_name AS "memberName", member_user_id AS "memberUserId", role,
              years_on_team AS "yearsOnTeam", graduation_year AS "graduationYear",
              season_year AS "seasonYear", highlights, advice_for_future AS "adviceForFuture",
              skills_to_document AS "skillsToDocument", willing_to_mentor AS "willingToMentor",
              contact_email AS "contactEmail", status, knowledge_page_id AS "knowledgePageId"
       FROM exit_interview_responses
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM exit_interview_responses WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const records = recordResult.rows.map(mapRecord);
  const summary = summarizeExitInterviews(records);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    records,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logExitInterview(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    memberName: string;
    role: ExitInterviewRole;
    yearsOnTeam: number;
    graduationYear: number;
    seasonYear: number;
    highlights: string | null;
    adviceForFuture: string | null;
    skillsToDocument: string | null;
    willingToMentor: boolean;
    contactEmail: string | null;
    status: ExitInterviewStatus;
  },
): Promise<{ id: string; knowledgePageId: string | null }> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO exit_interview_responses (
       org_id, member_name, role, years_on_team, graduation_year, season_year,
       highlights, advice_for_future, skills_to_document, willing_to_mentor,
       contact_email, status, submitted_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      input.orgId,
      input.memberName,
      input.role,
      Math.max(0, Math.round(input.yearsOnTeam)),
      Math.round(input.graduationYear),
      Math.round(input.seasonYear),
      input.highlights,
      input.adviceForFuture,
      input.skillsToDocument,
      input.willingToMentor,
      input.contactEmail,
      input.status,
      input.userId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("exit interview insert failed");

  if (input.status !== "submitted") {
    return { id, knowledgePageId: null };
  }

  const knowledgePageId = await insertExitInterviewWikiPage(client, { ...input, id });
  await client.query(
    `UPDATE exit_interview_responses
     SET knowledge_page_id = $1
     WHERE id = $2 AND org_id = $3`,
    [knowledgePageId, id, input.orgId],
  );
  return { id, knowledgePageId };
}

async function insertExitInterviewWikiPage(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    id: string;
    memberName: string;
    role: ExitInterviewRole;
    yearsOnTeam: number;
    graduationYear: number;
    seasonYear: number;
    highlights: string | null;
    adviceForFuture: string | null;
    skillsToDocument: string | null;
    willingToMentor: boolean;
    contactEmail: string | null;
  },
): Promise<string> {
  const title = exitInterviewWikiTitle({
    memberName: input.memberName,
    graduationYear: input.graduationYear,
  });
  const body = buildExitInterviewWikiBody(input);
  let slug = exitInterviewWikiSlug({
    memberName: input.memberName,
    seasonYear: input.seasonYear,
    suffix: input.id.slice(0, 8),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await client.query(`SELECT 1 FROM knowledge_pages WHERE org_id = $1::uuid AND slug = $2`, [
      input.orgId,
      slug,
    ]);
    if (!existing.rowCount) break;
    slug = exitInterviewWikiSlug({
      memberName: input.memberName,
      seasonYear: input.seasonYear,
      suffix: `${input.id.slice(0, 8)}${attempt}`,
    });
  }

  const page = await client.query<{ id: string }>(
    `INSERT INTO knowledge_pages
       (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
     VALUES ($1::uuid, $2, $3, $4, 'season_handoff', $5, $6::text[], false, $7::uuid, $7::uuid)
     RETURNING id`,
    [input.orgId, slug, title, body, input.seasonYear, ["handoff", "season", "exit-interview"], input.userId],
  );
  const pageId = page.rows[0]?.id;
  if (!pageId) throw new Error("wiki page insert failed");
  return pageId;
}

export async function deleteExitInterview(
  client: PoolClient,
  input: { orgId: string; recordId: string },
): Promise<void> {
  await client.query(`DELETE FROM exit_interview_responses WHERE id = $1 AND org_id = $2`, [
    input.recordId,
    input.orgId,
  ]);
}
