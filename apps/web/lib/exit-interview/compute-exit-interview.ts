import type { PoolClient } from "@neondatabase/serverless";
import { summarizeExitInterviews } from ".";
import {
  exitInviteExpiry,
  hashExitInviteToken,
  newExitInviteToken,
  type ExitInviteResponse,
  type ResolvedExitInvite,
} from "./invites";
import {
  buildExitInterviewWikiBody,
  exitInterviewWikiSlug,
  exitInterviewWikiTitle,
} from "./wiki";
import type {
  ExitInterviewInvite,
  ExitInterviewMember,
  ExitInterviewRecord,
  ExitInterviewRole,
  ExitInterviewStatus,
  ExitInterviewSummary,
} from "./types";

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
      /** Owner/admin: may mint self-serve links and see the pending list. */
      canManage: boolean;
      /** Roster for targeting an invite at a member (empty for non-admins). */
      members: ExitInterviewMember[];
      /** Pending / used self-serve links (owner/admin only; RLS hides the rest). */
      invites: ExitInterviewInvite[];
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
): Promise<{ orgId: string; teamNumber: number | null; role?: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role?: string }>(
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

type InviteRow = Omit<ExitInterviewInvite, "state" | "seasonYear"> & { seasonYear: number; expired: boolean };

function mapInvite(row: InviteRow): ExitInterviewInvite {
  return {
    id: row.id,
    memberName: row.memberName,
    memberEmail: row.memberEmail,
    memberUserId: row.memberUserId,
    seasonYear: Number(row.seasonYear),
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    responseId: row.responseId,
    createdAt: row.createdAt,
    state: row.usedAt ? "used" : row.expired ? "expired" : "open",
  };
}

/** Owner/admin only by RLS; degrades to [] before migration 0501 lands. */
async function loadInvites(client: PoolClient, orgId: string, seasonYear: number): Promise<ExitInterviewInvite[]> {
  try {
    const rows = await client.query<InviteRow>(
      `SELECT id, member_name AS "memberName", member_email AS "memberEmail",
              member_user_id AS "memberUserId", season_year AS "seasonYear",
              expires_at::text AS "expiresAt", used_at::text AS "usedAt",
              response_id AS "responseId", created_at::text AS "createdAt",
              (expires_at <= now()) AS expired
       FROM exit_interview_invites
       WHERE org_id = $1::uuid AND season_year = $2 AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [orgId, seasonYear],
    );
    return rows.rows.map(mapInvite);
  } catch {
    return [];
  }
}

async function loadMembers(client: PoolClient, orgId: string): Promise<ExitInterviewMember[]> {
  const rows = await client.query<ExitInterviewMember>(
    `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS name, u.email
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY lower(COALESCE(NULLIF(btrim(u.name), ''), u.email))`,
    [orgId],
  );
  return rows.rows.filter((row) => typeof row.userId === "string");
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

  const canManage = org.role === "owner" || org.role === "admin";
  const [recordResult, seasonResult, invites, members] = await Promise.all([
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
    canManage ? loadInvites(client, org.orgId, seasonYear) : Promise.resolve([]),
    canManage ? loadMembers(client, org.orgId) : Promise.resolve([]),
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
    canManage,
    members,
    invites,
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
    memberUserId?: string | null;
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
       org_id, member_name, member_user_id, role, years_on_team, graduation_year, season_year,
       highlights, advice_for_future, skills_to_document, willing_to_mentor,
       contact_email, status, submitted_by
     ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      input.orgId,
      input.memberName,
      input.memberUserId ?? null,
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

// ---- self-serve invites (owner/admin; RLS enforces) ----

export async function createExitInvite(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    memberName: string;
    memberUserId: string | null;
    memberEmail: string | null;
    seasonYear: number;
  },
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  if (input.memberUserId) {
    const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
      input.orgId,
      input.memberUserId,
    ]);
    if (!member.rowCount) throw new Error("That member is not in this organization");
  }
  if (!input.memberUserId && !input.memberEmail) {
    throw new Error("Pick a member or enter the email the link will be sent to");
  }
  const token = newExitInviteToken();
  const expiresAt = exitInviteExpiry();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO exit_interview_invites
       (org_id, member_user_id, member_email, member_name, season_year, token_hash, expires_at, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::uuid)
     RETURNING id`,
    [
      input.orgId,
      input.memberUserId,
      input.memberEmail,
      input.memberName,
      Math.round(input.seasonYear),
      hashExitInviteToken(token),
      expiresAt.toISOString(),
      input.userId,
    ],
  );
  const inviteId = inserted.rows[0]?.id;
  if (!inviteId) throw new Error("invite insert failed");
  return { inviteId, token, expiresAt: expiresAt.toISOString() };
}

export async function revokeExitInvite(client: PoolClient, input: { orgId: string; inviteId: string }): Promise<void> {
  await client.query(
    `UPDATE exit_interview_invites SET revoked_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND used_at IS NULL`,
    [input.inviteId, input.orgId],
  );
}

/**
 * Writes a self-serve response through the same path as the mentor form, then
 * burns the invite. Runs inside withRls scoped as the invite's creator (an
 * owner/admin) — the invitee has no session. Throws "used" if the link was
 * consumed concurrently so the caller never double-writes.
 */
export async function submitExitInviteResponse(
  client: PoolClient,
  input: { invite: ResolvedExitInvite; response: ExitInviteResponse },
): Promise<{ responseId: string; knowledgePageId: string | null }> {
  const { invite, response } = input;
  const logged = await logExitInterview(client, {
    orgId: invite.orgId,
    userId: invite.createdBy,
    memberName: invite.memberName,
    memberUserId: invite.memberUserId,
    role: response.role,
    yearsOnTeam: response.yearsOnTeam,
    graduationYear: response.graduationYear,
    seasonYear: invite.seasonYear,
    highlights: response.highlights,
    adviceForFuture: response.adviceForFuture,
    skillsToDocument: response.skillsToDocument,
    willingToMentor: response.willingToMentor,
    contactEmail: response.contactEmail,
    status: "submitted",
  });
  const burned = await client.query(
    `UPDATE exit_interview_invites SET used_at = now(), response_id = $3::uuid
     WHERE id = $1::uuid AND org_id = $2::uuid AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [invite.inviteId, invite.orgId, logged.id],
  );
  if (!burned.rowCount) throw new Error("used");
  return { responseId: logged.id, knowledgePageId: logged.knowledgePageId };
}
