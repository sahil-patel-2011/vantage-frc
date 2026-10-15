import { withRls } from "@vantage/db";
import {
  isUuid,
  lessonErrorResponse,
  privateJson,
  readLessonJson,
  requireLessonSession,
  requireOrgId,
} from "../../../lib/team-lessons/http";
import { canCreateLessons, canManageLessons } from "../../../lib/team-lessons/permissions";
import {
  attachLessonPdf,
  createLesson,
  isLessonsSchemaMissing,
  LessonHttpError,
  LESSONS_SETUP_MESSAGE,
  lessonPdfFolder,
  listLessons,
  requireLessonRole,
} from "../../../lib/team-lessons/store";
import type { LessonsListView } from "../../../lib/team-lessons/types";

export const dynamic = "force-dynamic";

/** The team's lessons: published for everyone, drafts for the people who can see them. */
export async function GET(request: Request) {
  try {
    const { userId } = await requireLessonSession();
    const orgId = requireOrgId(new URL(request.url).searchParams.get("orgId"));
    const view = await withRls({ userId, orgId }, async (client): Promise<LessonsListView> => {
      const role = await requireLessonRole(client, orgId, userId);
      const { published, drafts } = await listLessons(client, { orgId, userId, role });
      return {
        status: "ready",
        orgId,
        role,
        canCreate: canCreateLessons(role),
        canManage: canManageLessons(role),
        published,
        drafts,
      };
    });
    return privateJson(view);
  } catch (error) {
    // Only a missing migration is setup. An outage falls through to a 503 the page shows as an
    // error with Try again (lessonErrorResponse), never as "Needs setup".
    if (isLessonsSchemaMissing(error)) {
      return privateJson({ status: "setup_required", message: LESSONS_SETUP_MESSAGE } satisfies LessonsListView);
    }
    return lessonErrorResponse(error, "Team resources could not be loaded. Try again.");
  }
}

/**
 * A new draft lesson, written by the signed-in person: `{ orgId, title, pdfFileId? }`. The title
 * is required, so no nameless "Untitled lesson" rows are made. With `pdfFileId` (a PDF already
 * uploaded to the team's Files) the lesson is created as a PDF lesson in the same transaction,
 * so a refused file leaves no empty draft behind.
 *
 * `{ orgId, action: "pdf-folder" }` answers where "Upload a PDF lesson" should put the file
 * before any lesson exists.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireLessonSession();
    const body = await readLessonJson(request);
    const orgId = requireOrgId(body.orgId);
    if (body.action === "pdf-folder") {
      const folderId = await withRls({ userId, orgId }, async (client) => {
        const role = await requireLessonRole(client, orgId, userId);
        if (!canCreateLessons(role)) throw new LessonHttpError(403, "View only members can take lessons but not write them.");
        return lessonPdfFolder(client, { orgId, userId });
      });
      return privateJson({ folderId });
    }
    if (body.action !== undefined) throw new LessonHttpError(400, "Unknown lesson action.");
    const title = typeof body.title === "string" ? body.title.slice(0, 160) : undefined;
    if (body.pdfFileId !== undefined && !isUuid(body.pdfFileId)) throw new LessonHttpError(400, "Upload the PDF again.");
    const pdfFileId = body.pdfFileId as string | undefined;
    const created = await withRls({ userId, orgId }, async (client) => {
      const role = await requireLessonRole(client, orgId, userId);
      const lesson = await createLesson(client, { orgId, userId, role, title });
      if (!pdfFileId) return lesson;
      const attached = await attachLessonPdf(client, { orgId, userId, role, id: lesson.id, version: lesson.version, fileId: pdfFileId });
      return { id: lesson.id, version: attached.version };
    });
    return privateJson(created, 201);
  } catch (error) {
    return lessonErrorResponse(error, "The lesson could not be created. Try again.");
  }
}
