import type { PoolClient } from "@neondatabase/serverless";
import { summarizeExitInterviews } from ".";
import { matchPersonName } from "../presence/match-names";
import { loadRoster } from "../work-items/service";
import {
  assertCanDeleteResponse,
  assertCanEditResponse,
  ExitInterviewError,
  nextStatus,
  shouldPublishWiki,
} from "./lifecycle";
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
      /** Owner/admin. Drives which controls render; the server still enforces every write. */
      canManage: boolean;
      /** The signed-in member, so the UI can tell "my draft" from a teammate's. */
      viewerId: string;
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
): Promise<{ orgId: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
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
      message: "Choose your team to capture graduation exit interviews.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
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
    canManage: org.role === "owner" || org.role === "admin",
    viewerId: input.userId,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Link the free-text `memberName` to a roster user when the match is unambiguous.
 *
 * The column has always existed and was never populated, so every exit interview was a loose
 * string. Resolving it here means the alumni record survives a name being typed differently next
 * season, and a graduating member can later be recognised as the author of their own handoff.
 * An explicit `memberUserId` from the caller wins; an uncertain name simply stays unlinked rather
 * than being attached to the wrong person.
 */
async function resolveMemberUserId(
  client: PoolClient,
  input: { orgId: string; memberName: string; memberUserId?: string | null },
): Promise<string | null> {
  if (input.memberUserId) {
    const onRoster = await client.query(
      `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
      [input.orgId, input.memberUserId],
    );
    if (!onRoster.rowCount) {
      throw new ExitInterviewError("That member is not on this team's roster.", 404);
    }
    return input.memberUserId;
  }
  const roster = await loadRoster(client, input.orgId);
  const match = matchPersonName(input.memberName, roster);
  return match.autoUserId;
}

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
    memberUserId?: string | null;
  },
): Promise<{ id: string; knowledgePageId: string | null; memberUserId: string | null }> {
  const memberUserId = await resolveMemberUserId(client, {
    orgId: input.orgId,
    memberName: input.memberName,
    memberUserId: input.memberUserId,
  });

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO exit_interview_responses (
       org_id, member_name, member_user_id, role, years_on_team, graduation_year, season_year,
       highlights, advice_for_future, skills_to_document, willing_to_mentor,
       contact_email, status, submitted_by
     ) VALUES ($1,$2,$14::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
      memberUserId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("exit interview insert failed");

  if (input.status !== "submitted") {
    return { id, knowledgePageId: null, memberUserId };
  }

  const knowledgePageId = await insertExitInterviewWikiPage(client, { ...input, id });
  await client.query(
    `UPDATE exit_interview_responses
     SET knowledge_page_id = $1
     WHERE id = $2 AND org_id = $3`,
    [knowledgePageId, id, input.orgId],
  );
  return { id, knowledgePageId, memberUserId };
}

type StoredResponse = {
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
  submittedBy: string;
};

async function loadResponse(
  client: PoolClient,
  input: { orgId: string; recordId: string },
): Promise<StoredResponse> {
  const row = await client.query<StoredResponse>(
    `SELECT id, member_name AS "memberName", member_user_id AS "memberUserId", role,
            years_on_team AS "yearsOnTeam", graduation_year AS "graduationYear",
            season_year AS "seasonYear", highlights, advice_for_future AS "adviceForFuture",
            skills_to_document AS "skillsToDocument", willing_to_mentor AS "willingToMentor",
            contact_email AS "contactEmail", status, knowledge_page_id AS "knowledgePageId",
            submitted_by AS "submittedBy"
     FROM exit_interview_responses
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.recordId, input.orgId],
  );
  const found = row.rows[0];
  if (!found) throw new ExitInterviewError("That exit interview was not found.", 404);
  return found;
}

/**
 * Edit a record and, when it moves from draft to submitted, publish the handoff wiki page.
 *
 * Fields left `undefined` keep their stored value, so the client can send a partial edit (or a
 * bare "submit") without having to round-trip every answer and risk blanking one.
 */
export async function updateExitInterview(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    actorRole: string | null;
    recordId: string;
    memberName?: string | null;
    memberUserId?: string | null;
    role?: ExitInterviewRole | null;
    yearsOnTeam?: number | null;
    graduationYear?: number | null;
    highlights?: string | null | undefined;
    adviceForFuture?: string | null | undefined;
    skillsToDocument?: string | null | undefined;
    willingToMentor?: boolean | null;
    contactEmail?: string | null | undefined;
    status?: ExitInterviewStatus | null;
  },
): Promise<{ id: string; status: ExitInterviewStatus; knowledgePageId: string | null }> {
  const stored = await loadResponse(client, { orgId: input.orgId, recordId: input.recordId });

  assertCanEditResponse(
    { role: input.actorRole, userId: input.userId },
    {
      status: stored.status,
      submittedBy: stored.submittedBy,
      memberUserId: stored.memberUserId,
    },
  );

  const status = nextStatus(stored.status, input.status);
  const memberName = input.memberName?.trim() || stored.memberName;
  const memberUserId =
    input.memberUserId !== undefined || memberName !== stored.memberName
      ? await resolveMemberUserId(client, {
          orgId: input.orgId,
          memberName,
          memberUserId: input.memberUserId,
        })
      : stored.memberUserId;

  const merged = {
    memberName,
    role: input.role ?? stored.role,
    yearsOnTeam: Math.max(0, Math.round(input.yearsOnTeam ?? stored.yearsOnTeam)),
    graduationYear: Math.round(input.graduationYear ?? stored.graduationYear),
    seasonYear: stored.seasonYear,
    highlights: input.highlights !== undefined ? input.highlights : stored.highlights,
    adviceForFuture:
      input.adviceForFuture !== undefined ? input.adviceForFuture : stored.adviceForFuture,
    skillsToDocument:
      input.skillsToDocument !== undefined ? input.skillsToDocument : stored.skillsToDocument,
    willingToMentor: input.willingToMentor ?? stored.willingToMentor,
    contactEmail: input.contactEmail !== undefined ? input.contactEmail : stored.contactEmail,
  };

  const publish = shouldPublishWiki({
    previousStatus: stored.status,
    nextStatus: status,
    existingPageId: stored.knowledgePageId,
  });

  const knowledgePageId = publish
    ? await insertExitInterviewWikiPage(client, {
        ...merged,
        orgId: input.orgId,
        userId: input.userId,
        id: stored.id,
      })
    : stored.knowledgePageId;

  await client.query(
    `UPDATE exit_interview_responses
     SET member_name = $3, member_user_id = $4::uuid, role = $5, years_on_team = $6,
         graduation_year = $7, highlights = $8, advice_for_future = $9,
         skills_to_document = $10, willing_to_mentor = $11, contact_email = $12,
         status = $13, knowledge_page_id = $14::uuid
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      stored.id,
      input.orgId,
      merged.memberName,
      memberUserId,
      merged.role,
      merged.yearsOnTeam,
      merged.graduationYear,
      merged.highlights,
      merged.adviceForFuture,
      merged.skillsToDocument,
      merged.willingToMentor,
      merged.contactEmail,
      status,
      knowledgePageId,
    ],
  );

  return { id: stored.id, status, knowledgePageId };
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

/**
 * Delete a record. The published handoff page is deliberately left in the wiki: teammates link to
 * it, and the knowledge is the team's even after the interview row is cleaned up. The returned
 * `knowledgePageId` lets the caller tell the mentor where that page still lives.
 */
export async function deleteExitInterview(
  client: PoolClient,
  input: { orgId: string; recordId: string; actorRole: string | null; userId: string },
): Promise<{ deleted: boolean; knowledgePageId: string | null }> {
  assertCanDeleteResponse({ role: input.actorRole, userId: input.userId });
  const removed = await client.query<{ knowledgePageId: string | null }>(
    `DELETE FROM exit_interview_responses
     WHERE id = $1::uuid AND org_id = $2::uuid
     RETURNING knowledge_page_id AS "knowledgePageId"`,
    [input.recordId, input.orgId],
  );
  const row = removed.rows[0];
  if (!row) throw new ExitInterviewError("That exit interview was not found.", 404);
  return { deleted: true, knowledgePageId: row.knowledgePageId };
}
