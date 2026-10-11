/**
 * Data access for team lessons (migration 0717). Server-only.
 *
 * Every statement runs on the client `withRls({ userId, orgId })` hands the route, so 0717's
 * policies are the real guard; the explicit `org_id = $n::uuid` on each statement and the
 * role checks in ./permissions are the second layer, there so a refusal reads as a sentence.
 * Raw parameterized SQL with explicit casts, the house pattern.
 */

import { isDatabaseFailure } from "../outage/classify";
import type { PoolClient } from "@neondatabase/serverless";
import {
  gradePractice,
  lessonPublishProblems,
  parseLessonBody,
  parsePracticeAnswers,
  publicLessonBody,
} from "./body";
import {
  asLessonRole,
  canChangeLessonStatus,
  canCreateLessons,
  canDeleteLesson,
  canEditLesson,
  canManageLessons,
  canPublishLesson,
  editRefusal,
} from "./permissions";
import {
  DEFAULT_LESSON_TITLE,
  type LessonAttempt,
  type LessonBody,
  type LessonDetail,
  type LessonMeta,
  type LessonRevisionSummary,
  type LessonRole,
  type LessonSource,
  type LessonStatus,
  type LessonSummary,
  type PracticeResult,
} from "./types";

/** The part of a PoolClient this module uses, so tests can hand in a stub. */
export type LessonClient = Pick<PoolClient, "query">;

export class LessonHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** History kept per lesson, and how often an autosave adds to it. */
export const REVISIONS_KEPT = 50;
export const REVISION_INTERVAL_MINUTES = 5;
/** Lessons listed per team; a team with more archives older ones. */
const LIST_LIMIT = 200;
/** Where uploaded lesson PDFs go in the team's Drive. */
export const LESSON_PDF_FOLDER = "Team lessons";

const EMPTY_BODY_JSON = '{"steps":[],"practice":[]}';

/** A timestamp as an ISO 8601 string, whatever the driver does with timestamptz. */
const iso = (column: string) => `to_json(${column}) #>> '{}'`;

type LessonRow = {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  audience: string;
  minutes: number | null;
  status: LessonStatus;
  source: LessonSource;
  body: unknown;
  pdfFileId: string | null;
  pdfFileName: string | null;
  version: number;
  createdBy: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
  publishedAt: string | null;
};

const LESSON_COLUMNS = `
  l.id, l.org_id AS "orgId", l.title, l.summary, l.audience, l.minutes, l.status, l.source, l.body,
  l.pdf_file_id AS "pdfFileId", f.name AS "pdfFileName", l.version,
  l.created_by AS "createdBy", cu.name AS "createdByName",
  ${iso("l.updated_at")} AS "updatedAt", uu.name AS "updatedByName",
  ${iso("l.published_at")} AS "publishedAt"`;

const LESSON_JOINS = `
  LEFT JOIN users cu ON cu.id = l.created_by
  LEFT JOIN users uu ON uu.id = l.updated_by
  LEFT JOIN drive_files f ON f.id = l.pdf_file_id AND f.deleted_at IS NULL`;

/** Postgres says "no such table/column" before 0717 is applied: a setup state, not a crash. */
export function isLessonsSchemaMissing(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (code === "42P01") return true;
  return code === "42703" && /team_lesson/i.test(message);
}

/**
 * No database configured, or it can't be reached: the outage classifier's call, so lessons and the
 * NAS-down alerts agree on what counts as "the database is down".
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /DATABASE_URL|DATABASE_AUTH_URL/.test(message) || isDatabaseFailure(error);
}

export const LESSONS_SETUP_MESSAGE =
  "Team lessons aren't switched on for this server yet. The person who runs Vantage for your team needs to apply the latest database update.";

export const LESSONS_UNREACHABLE_MESSAGE =
  "Vantage can't reach its database right now, so lessons can't load. Your work in the editor is kept on this device; try again in a few minutes.";

/** The caller's role in this team, or a 403. */
export async function requireLessonRole(client: LessonClient, orgId: string, userId: string): Promise<LessonRole> {
  const result = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = asLessonRole(result.rows[0]?.role);
  if (!role) throw new LessonHttpError(403, "You are not on this team. Choose your team and try again.");
  return role;
}

// ---------------------------------------------------------------- reads

type SummaryRow = Omit<LessonSummary, "canEdit" | "best">;
type BestRow = { lessonId: string; score: number; total: number; passed: boolean; at: string };

export async function listLessons(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole },
): Promise<{ published: LessonSummary[]; drafts: LessonSummary[] }> {
  const lessons = await client.query<SummaryRow>(
    `SELECT l.id, l.title, l.summary, l.audience, l.minutes, l.status, l.source,
            jsonb_array_length(l.body -> 'steps') AS "stepCount",
            jsonb_array_length(l.body -> 'practice') AS "questionCount",
            l.created_by AS "createdBy", cu.name AS "createdByName",
            ${iso("l.updated_at")} AS "updatedAt", ${iso("l.published_at")} AS "publishedAt"
       FROM team_lessons l
       LEFT JOIN users cu ON cu.id = l.created_by
      WHERE l.org_id = $1::uuid
      ORDER BY CASE l.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
               l.published_at DESC NULLS LAST, l.updated_at DESC
      LIMIT ${LIST_LIMIT}`,
    [input.orgId],
  );
  const best = await client.query<BestRow>(
    `SELECT DISTINCT ON (a.lesson_id)
            a.lesson_id AS "lessonId", a.score, a.total, a.passed, ${iso("a.created_at")} AS "at"
       FROM team_lesson_attempts a
      WHERE a.org_id = $1::uuid AND a.user_id = $2::uuid
      ORDER BY a.lesson_id, a.passed DESC, (a.score::numeric / NULLIF(a.total, 0)) DESC NULLS LAST, a.created_at DESC`,
    [input.orgId, input.userId],
  );
  const bestByLesson = new Map(best.rows.map((row) => [row.lessonId, row]));
  const rows = lessons.rows.map<LessonSummary>((row) => {
    const top = bestByLesson.get(row.id);
    return {
      ...row,
      stepCount: Number(row.stepCount),
      questionCount: Number(row.questionCount),
      canEdit: canEditLesson(input.role, input.userId, row),
      best: top ? { score: top.score, total: top.total, passed: top.passed, at: top.at } : null,
    };
  });
  return {
    published: rows.filter((row) => row.status === "published"),
    drafts: rows.filter((row) => row.status !== "published"),
  };
}

async function readLesson(client: LessonClient, orgId: string, id: string, lock = false): Promise<LessonRow | null> {
  // FOR UPDATE OF l locks only the lesson; the outer-joined names are never locked.
  const result = await client.query<LessonRow>(
    `SELECT ${LESSON_COLUMNS}
       FROM team_lessons l ${LESSON_JOINS}
      WHERE l.id = $1::uuid AND l.org_id = $2::uuid
      ${lock ? "FOR UPDATE OF l" : ""}`,
    [id, orgId],
  );
  return result.rows[0] ?? null;
}

function storedBody(row: { body: unknown }): LessonBody {
  const parsed = parseLessonBody(row.body);
  if (!parsed.ok) throw new LessonHttpError(422, "This lesson's saved content could not be read. Restore an earlier version from History.");
  return parsed.value;
}

function toDetail(row: LessonRow, role: LessonRole, userId: string): LessonDetail {
  const editor = canEditLesson(role, userId, row);
  const body = storedBody(row);
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    summary: row.summary,
    audience: row.audience,
    minutes: row.minutes,
    status: row.status,
    source: row.source,
    pdfFileId: row.pdfFileId,
    pdfFileName: row.pdfFileName,
    version: Number(row.version),
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
    publishedAt: row.publishedAt,
    body: editor ? body : publicLessonBody(body),
    editor,
    canPublish: canPublishLesson(role, userId, row),
    canChangeStatus: canChangeLessonStatus(role),
    canDelete: canDeleteLesson(role, userId, row),
  };
}

export async function getLessonDetail(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string },
): Promise<{ lesson: LessonDetail; attempts: LessonAttempt[]; revisions: LessonRevisionSummary[] }> {
  const row = await readLesson(client, input.orgId, input.id);
  if (!row) throw new LessonHttpError(404, "That lesson doesn't exist, or it isn't published yet.");
  const lesson = toDetail(row, input.role, input.userId);
  const attempts = await listMyAttempts(client, { orgId: input.orgId, userId: input.userId, lessonId: input.id });
  const revisions = lesson.editor ? await listRevisions(client, { orgId: input.orgId, lessonId: input.id }) : [];
  return { lesson, attempts, revisions };
}

export async function listMyAttempts(
  client: LessonClient,
  input: { orgId: string; userId: string; lessonId: string },
): Promise<LessonAttempt[]> {
  const result = await client.query<LessonAttempt>(
    `SELECT id, score, total, passed, ${iso("created_at")} AS "createdAt"
       FROM team_lesson_attempts
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id = $3::uuid
      ORDER BY created_at DESC
      LIMIT 20`,
    [input.orgId, input.userId, input.lessonId],
  );
  return result.rows;
}

export async function listRevisions(
  client: LessonClient,
  input: { orgId: string; lessonId: string },
): Promise<LessonRevisionSummary[]> {
  const result = await client.query<LessonRevisionSummary>(
    `SELECT r.id, r.version, r.title, ${iso("r.saved_at")} AS "savedAt", u.name AS "savedByName"
       FROM team_lesson_revisions r
       LEFT JOIN users u ON u.id = r.saved_by
      WHERE r.org_id = $1::uuid AND r.lesson_id = $2::uuid
      ORDER BY r.saved_at DESC, r.id DESC
      LIMIT ${REVISIONS_KEPT}`,
    [input.orgId, input.lessonId],
  );
  return result.rows.map((row) => ({ ...row, version: Number(row.version) }));
}

// ---------------------------------------------------------------- writes

export async function createLesson(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; title?: string },
): Promise<{ id: string; version: number }> {
  if (!canCreateLessons(input.role)) {
    throw new LessonHttpError(403, "View only members can take lessons but not write them.");
  }
  const title = (input.title ?? "").trim() || DEFAULT_LESSON_TITLE;
  const result = await client.query<{ id: string; version: number }>(
    `INSERT INTO team_lessons (org_id, title, created_by, updated_by)
     VALUES ($1::uuid, $2::text, $3::uuid, $3::uuid)
     RETURNING id, version`,
    [input.orgId, title, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new LessonHttpError(500, "The lesson could not be created.");
  return { id: row.id, version: Number(row.version) };
}

type Locked = { row: LessonRow; role: LessonRole };

/**
 * Locks the lesson for a write by someone allowed to edit it, and checks they saw the latest
 * version. A row this person can read but not edit is invisible to FOR UPDATE (0717's UPDATE
 * policy), so the plain read afterwards tells a 403 from a 404.
 */
async function lockForEdit(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; version: number | null },
): Promise<Locked> {
  const row = await readLesson(client, input.orgId, input.id, true);
  if (!row) {
    const visible = await readLesson(client, input.orgId, input.id);
    if (!visible) throw new LessonHttpError(404, "That lesson doesn't exist, or it was deleted.");
    throw new LessonHttpError(403, editRefusal(input.role, input.userId, visible));
  }
  if (!canEditLesson(input.role, input.userId, row)) {
    throw new LessonHttpError(403, editRefusal(input.role, input.userId, row));
  }
  if (input.version !== null && Number(row.version) !== input.version) {
    const current = (await readLesson(client, input.orgId, input.id)) ?? row;
    throw new LessonHttpError(409, "Someone else edited this lesson while you were working. Reload to see their changes.", {
      conflict: {
        version: Number(current.version),
        title: current.title,
        summary: current.summary,
        audience: current.audience,
        minutes: current.minutes,
        source: current.source,
        pdfFileId: current.pdfFileId,
        body: storedBody(current),
        updatedAt: current.updatedAt,
        updatedByName: current.updatedByName,
      },
    });
  }
  return { row, role: input.role };
}

/** Copies the lesson as it is now into its history: forced, or at most once per interval. */
async function snapshot(client: LessonClient, input: { orgId: string; userId: string; id: string; force: boolean }) {
  await client.query(
    `INSERT INTO team_lesson_revisions (org_id, lesson_id, version, title, body, saved_by)
     SELECT l.org_id, l.id, l.version, l.title, l.body, $3::uuid
       FROM team_lessons l
      WHERE l.id = $1::uuid AND l.org_id = $2::uuid
        AND ($4::boolean OR (
              l.body <> $5::jsonb
          AND NOT EXISTS (
                SELECT 1 FROM team_lesson_revisions r
                 WHERE r.lesson_id = l.id
                   AND r.saved_at > now() - make_interval(mins => $6::int))))`,
    [input.id, input.orgId, input.userId, input.force, EMPTY_BODY_JSON, REVISION_INTERVAL_MINUTES],
  );
}

/** Keeps the newest REVISIONS_KEPT for one lesson. */
async function prune(client: LessonClient, input: { orgId: string; id: string }) {
  await client.query(
    `DELETE FROM team_lesson_revisions
      WHERE org_id = $2::uuid AND lesson_id = $1::uuid
        AND id IN (
          SELECT id FROM team_lesson_revisions
           WHERE org_id = $2::uuid AND lesson_id = $1::uuid
           ORDER BY saved_at DESC, id DESC
          OFFSET $3::int)`,
    [input.id, input.orgId, REVISIONS_KEPT],
  );
}

type Saved = { version: number; updatedAt: string };

export async function autosaveLesson(
  client: LessonClient,
  input: {
    orgId: string;
    userId: string;
    role: LessonRole;
    id: string;
    version: number;
    meta: Partial<LessonMeta>;
    body: LessonBody | null;
  },
): Promise<Saved> {
  await lockForEdit(client, input);
  await snapshot(client, { ...input, force: false });
  const title = input.meta.title === undefined ? null : input.meta.title.trim() || DEFAULT_LESSON_TITLE;
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET title = COALESCE($3::text, title),
            summary = COALESCE($4::text, summary),
            audience = COALESCE($5::text, audience),
            minutes = CASE WHEN $6::boolean THEN $7::int ELSE minutes END,
            body = COALESCE($8::jsonb, body),
            version = version + 1,
            updated_by = $9::uuid,
            updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND version = $10::int
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [
      input.id,
      input.orgId,
      title,
      input.meta.summary ?? null,
      input.meta.audience ?? null,
      input.meta.minutes !== undefined,
      input.meta.minutes ?? null,
      input.body ? JSON.stringify(input.body) : null,
      input.userId,
      input.version,
    ],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(409, "Someone else edited this lesson while you were working. Reload to see their changes.");
  await prune(client, input);
  return { version: Number(saved.version), updatedAt: saved.updatedAt };
}

export async function publishLesson(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; version: number },
): Promise<Saved> {
  const { row } = await lockForEdit(client, input);
  if (!canPublishLesson(input.role, input.userId, row)) throw new LessonHttpError(409, "This lesson is already published.");
  const problems = lessonPublishProblems(row, storedBody(row), { source: row.source, hasPdf: Boolean(row.pdfFileId) });
  if (problems.length) throw new LessonHttpError(422, "Finish these before publishing.", { problems });
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET status = 'published', published_at = now(), version = version + 1,
            updated_by = $3::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [input.id, input.orgId, input.userId],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(403, editRefusal(input.role, input.userId, row));
  // Every publish is kept in History, whatever the autosave interval.
  await snapshot(client, { ...input, force: true });
  await prune(client, input);
  return { version: Number(saved.version), updatedAt: saved.updatedAt };
}

/** Owners and admins: back to draft (from published or archived), or archive. */
export async function setLessonStatus(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; status: "draft" | "archived" },
): Promise<Saved> {
  if (!canChangeLessonStatus(input.role)) {
    throw new LessonHttpError(403, "Only a team owner or admin can move a lesson back to draft or archive it.");
  }
  await lockForEdit(client, { ...input, version: null });
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET status = $3::text, version = version + 1, updated_by = $4::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [input.id, input.orgId, input.status, input.userId],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(404, "That lesson doesn't exist, or it was deleted.");
  return { version: Number(saved.version), updatedAt: saved.updatedAt };
}

/**
 * Points the lesson at a PDF in the team's Drive. The file must be this team's (team space,
 * not someone's personal files), finished uploading, not in the trash, and a PDF.
 */
export async function attachLessonPdf(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; version: number; fileId: string },
): Promise<Saved & { pdfFileName: string }> {
  await lockForEdit(client, input);
  const file = await client.query<{ name: string; scope: string; status: string; contentType: string; deleted: boolean }>(
    `SELECT name, scope, status, content_type AS "contentType", deleted_at IS NOT NULL AS deleted
       FROM drive_files
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.fileId, input.orgId],
  );
  const pdf = file.rows[0];
  if (!pdf) throw new LessonHttpError(404, "That file isn't in this team's Files.");
  if (pdf.scope !== "team") throw new LessonHttpError(422, "Use a file in the team's Files, not your personal space, so everyone can open it.");
  if (pdf.deleted) throw new LessonHttpError(422, "That file is in the trash. Restore it in Files first.");
  if (pdf.status !== "ready") throw new LessonHttpError(409, "That upload hasn't finished yet. Try again in a moment.");
  if (pdf.contentType !== "application/pdf") throw new LessonHttpError(422, "Lessons take PDF files only.");
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET pdf_file_id = $3::uuid, source = 'pdf', version = version + 1,
            updated_by = $4::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [input.id, input.orgId, input.fileId, input.userId],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(404, "That lesson doesn't exist, or it was deleted.");
  return { version: Number(saved.version), updatedAt: saved.updatedAt, pdfFileName: pdf.name };
}

/** Back to written steps. The PDF stays in the team's Files. */
export async function detachLessonPdf(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; version: number },
): Promise<Saved> {
  await lockForEdit(client, input);
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET pdf_file_id = NULL, source = 'editor', version = version + 1,
            updated_by = $3::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [input.id, input.orgId, input.userId],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(404, "That lesson doesn't exist, or it was deleted.");
  return { version: Number(saved.version), updatedAt: saved.updatedAt };
}

/** Puts an earlier version back. What was there first goes into History, so this can be undone. */
export async function restoreLessonRevision(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string; version: number; revisionId: string },
): Promise<Saved & { title: string; body: LessonBody }> {
  await lockForEdit(client, input);
  const revision = await client.query<{ title: string; body: unknown }>(
    `SELECT title, body FROM team_lesson_revisions
      WHERE id = $1::uuid AND lesson_id = $2::uuid AND org_id = $3::uuid`,
    [input.revisionId, input.id, input.orgId],
  );
  const kept = revision.rows[0];
  if (!kept) throw new LessonHttpError(404, "That version is no longer in History.");
  const body = parseLessonBody(kept.body);
  if (!body.ok) throw new LessonHttpError(422, "That version could not be read, so it can't be restored.");
  const title = kept.title.trim() || DEFAULT_LESSON_TITLE;
  await snapshot(client, { ...input, force: true });
  const result = await client.query<Saved>(
    `UPDATE team_lessons
        SET title = $3::text, body = $4::jsonb, version = version + 1,
            updated_by = $5::uuid, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid
      RETURNING version, ${iso("updated_at")} AS "updatedAt"`,
    [input.id, input.orgId, title, JSON.stringify(body.value), input.userId],
  );
  const saved = result.rows[0];
  if (!saved) throw new LessonHttpError(404, "That lesson doesn't exist, or it was deleted.");
  await prune(client, input);
  return { version: Number(saved.version), updatedAt: saved.updatedAt, title, body: body.value };
}

export async function deleteLesson(
  client: LessonClient,
  input: { orgId: string; userId: string; role: LessonRole; id: string },
): Promise<void> {
  const row = await readLesson(client, input.orgId, input.id);
  if (!row) throw new LessonHttpError(404, "That lesson doesn't exist, or it was already deleted.");
  if (!canDeleteLesson(input.role, input.userId, row)) {
    throw new LessonHttpError(
      403,
      canManageLessons(input.role) || row.createdBy !== input.userId
        ? "Only a team owner or admin, or the author of a draft, can delete a lesson."
        : "Published lessons are deleted by a team owner or admin.",
    );
  }
  const result = await client.query(`DELETE FROM team_lessons WHERE id = $1::uuid AND org_id = $2::uuid`, [input.id, input.orgId]);
  if (!result.rowCount) throw new LessonHttpError(403, "This lesson can't be deleted by you.");
}

/**
 * Grades a submission on the server. Attempts on a published lesson are kept; a preview of a
 * draft by its editor is graded but not recorded.
 */
export async function submitPractice(
  client: LessonClient,
  input: { orgId: string; userId: string; id: string; answers: unknown },
): Promise<{ result: PracticeResult; stored: boolean; attempt: LessonAttempt | null }> {
  const row = await readLesson(client, input.orgId, input.id);
  if (!row) throw new LessonHttpError(404, "That lesson doesn't exist, or it isn't published yet.");
  const body = storedBody(row);
  const answers = parsePracticeAnswers(input.answers, body);
  if (!answers) throw new LessonHttpError(400, "Answers must be numbers or short text.");
  const result = gradePractice(body, answers);
  if (row.status !== "published" || result.total === 0) return { result, stored: false, attempt: null };
  const inserted = await client.query<LessonAttempt>(
    `INSERT INTO team_lesson_attempts (org_id, lesson_id, user_id, answers, score, total, passed)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::int, $6::int, $7::boolean)
     RETURNING id, score, total, passed, ${iso("created_at")} AS "createdAt"`,
    [input.orgId, input.id, input.userId, JSON.stringify(answers), result.score, result.total, result.passed],
  );
  return { result, stored: true, attempt: inserted.rows[0] ?? null };
}

/** The team Drive folder lesson PDFs are uploaded into, created on first use. */
export async function lessonPdfFolder(client: LessonClient, input: { orgId: string; userId: string }): Promise<string | null> {
  const find = () =>
    client.query<{ id: string }>(
      `SELECT id FROM drive_folders
        WHERE org_id = $1::uuid AND scope = 'team' AND parent_id IS NULL AND lower(name) = lower($2::text)
        LIMIT 1`,
      [input.orgId, LESSON_PDF_FOLDER],
    );
  const existing = await find();
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO drive_folders (org_id, scope, owner_user_id, parent_id, name, created_by)
     VALUES ($1::uuid, 'team', NULL, NULL, $2::text, $3::uuid)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [input.orgId, LESSON_PDF_FOLDER, input.userId],
  );
  return created.rows[0]?.id ?? (await find()).rows[0]?.id ?? null;
}
