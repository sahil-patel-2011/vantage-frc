import { withRls } from "@vantage/db";
import { parseLessonBody, parseLessonMeta } from "../../../../lib/team-lessons/body";
import {
  isUuid,
  LESSON_BODY_MAX_BYTES,
  lessonErrorResponse,
  privateJson,
  readLessonJson,
  requireLessonId,
  requireLessonSession,
  requireOrgId,
} from "../../../../lib/team-lessons/http";
import {
  attachLessonPdf,
  autosaveLesson,
  deleteLesson,
  detachLessonPdf,
  getLessonDetail,
  isDatabaseUnavailable,
  isLessonsSchemaMissing,
  LessonHttpError,
  LESSONS_SETUP_MESSAGE,
  lessonPdfFolder,
  listMyAttempts,
  publishLesson,
  requireLessonRole,
  restoreLessonRevision,
  setLessonStatus,
  submitPractice,
} from "../../../../lib/team-lessons/store";
import type { LessonDetailView } from "../../../../lib/team-lessons/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function requireVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new LessonHttpError(400, "Reload the lesson and try again.");
  }
  return value;
}

/**
 * One lesson. Editors get the full body (answers included) and the autosave history; everyone
 * else gets the steps and the questions without their answers. `?part=attempts` returns only
 * the signed-in person's practice attempts.
 */
export async function GET(request: Request, context: Context) {
  try {
    const { userId } = await requireLessonSession();
    const id = requireLessonId((await context.params).id);
    const url = new URL(request.url);
    const orgId = requireOrgId(url.searchParams.get("orgId"));
    if (url.searchParams.get("part") === "attempts") {
      const attempts = await withRls({ userId, orgId }, async (client) => {
        await requireLessonRole(client, orgId, userId);
        return listMyAttempts(client, { orgId, userId, lessonId: id });
      });
      return privateJson({ attempts });
    }
    const view = await withRls({ userId, orgId }, async (client): Promise<LessonDetailView> => {
      const role = await requireLessonRole(client, orgId, userId);
      const detail = await getLessonDetail(client, { orgId, userId, role, id });
      return { status: "ready", role, ...detail };
    });
    return privateJson(view);
  } catch (error) {
    if (isLessonsSchemaMissing(error) || isDatabaseUnavailable(error)) {
      return privateJson({ status: "setup_required", message: LESSONS_SETUP_MESSAGE } satisfies LessonDetailView);
    }
    return lessonErrorResponse(error, "This lesson could not be loaded. Try again.");
  }
}

/**
 * Autosave: `{ orgId, version, title?, summary?, audience?, minutes?, body? }`. Answers 409 with
 * the saved lesson (`conflict`) when `version` is not the latest, so the editor can offer a reload.
 */
export async function PATCH(request: Request, context: Context) {
  try {
    const { userId } = await requireLessonSession();
    const id = requireLessonId((await context.params).id);
    const input = await readLessonJson(request, LESSON_BODY_MAX_BYTES);
    const orgId = requireOrgId(input.orgId);
    const version = requireVersion(input.version);
    const meta = parseLessonMeta(input);
    if (!meta.ok) throw new LessonHttpError(400, meta.error);
    let body = null;
    if (input.body !== undefined) {
      const parsed = parseLessonBody(input.body);
      if (!parsed.ok) throw new LessonHttpError(400, parsed.error);
      body = parsed.value;
    }
    const saved = await withRls({ userId, orgId }, async (client) => {
      const role = await requireLessonRole(client, orgId, userId);
      return autosaveLesson(client, { orgId, userId, role, id, version, meta: meta.value, body });
    });
    return privateJson(saved);
  } catch (error) {
    return lessonErrorResponse(error, "Couldn't save. Your text is still here; Vantage will try again.");
  }
}

/**
 * Actions on one lesson: `publish`, `unpublish` (back to draft), `archive`, `attach-pdf`,
 * `detach-pdf`, `restore` (a History version), `pdf-folder` (where to upload a lesson PDF) and
 * `submit` (practice answers, graded here and kept for published lessons).
 */
export async function POST(request: Request, context: Context) {
  try {
    const { userId } = await requireLessonSession();
    const id = requireLessonId((await context.params).id);
    const input = await readLessonJson(request);
    const orgId = requireOrgId(input.orgId);
    const action = typeof input.action === "string" ? input.action : "";
    const result = await withRls({ userId, orgId }, async (client) => {
      const role = await requireLessonRole(client, orgId, userId);
      const who = { orgId, userId, role, id };
      switch (action) {
        case "submit":
          return submitPractice(client, { orgId, userId, id, answers: input.answers });
        case "publish":
          return publishLesson(client, { ...who, version: requireVersion(input.version) });
        case "unpublish":
          return setLessonStatus(client, { ...who, status: "draft" });
        case "archive":
          return setLessonStatus(client, { ...who, status: "archived" });
        case "attach-pdf": {
          if (!isUuid(input.fileId)) throw new LessonHttpError(400, "Upload the PDF again.");
          return attachLessonPdf(client, { ...who, version: requireVersion(input.version), fileId: input.fileId });
        }
        case "detach-pdf":
          return detachLessonPdf(client, { ...who, version: requireVersion(input.version) });
        case "restore": {
          if (!isUuid(input.revisionId)) throw new LessonHttpError(404, "That version is no longer in History.");
          return restoreLessonRevision(client, { ...who, version: requireVersion(input.version), revisionId: input.revisionId });
        }
        case "pdf-folder":
          return { folderId: await lessonPdfFolder(client, { orgId, userId }) };
        default:
          throw new LessonHttpError(400, "Unknown lesson action.");
      }
    });
    return privateJson(result);
  } catch (error) {
    return lessonErrorResponse(error, "That didn't work. Try again.");
  }
}

/** Owners and admins delete any lesson; the author deletes their own draft. */
export async function DELETE(request: Request, context: Context) {
  try {
    const { userId } = await requireLessonSession();
    const id = requireLessonId((await context.params).id);
    const orgId = requireOrgId(new URL(request.url).searchParams.get("orgId"));
    await withRls({ userId, orgId }, async (client) => {
      const role = await requireLessonRole(client, orgId, userId);
      await deleteLesson(client, { orgId, userId, role, id });
    });
    return privateJson({ deleted: true });
  } catch (error) {
    return lessonErrorResponse(error, "The lesson could not be deleted. Try again.");
  }
}
