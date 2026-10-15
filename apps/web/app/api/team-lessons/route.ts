import { withRls } from "@vantage/db";
import {
  lessonErrorResponse,
  privateJson,
  readLessonJson,
  requireLessonSession,
  requireOrgId,
} from "../../../lib/team-lessons/http";
import { canCreateLessons, canManageLessons } from "../../../lib/team-lessons/permissions";
import {
  createLesson,
  isLessonsSchemaMissing,
  LESSONS_SETUP_MESSAGE,
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

/** A new draft lesson, written by the signed-in person. */
export async function POST(request: Request) {
  try {
    const { userId } = await requireLessonSession();
    const body = await readLessonJson(request);
    const orgId = requireOrgId(body.orgId);
    const title = typeof body.title === "string" ? body.title.slice(0, 160) : undefined;
    const created = await withRls({ userId, orgId }, async (client) => {
      const role = await requireLessonRole(client, orgId, userId);
      return createLesson(client, { orgId, userId, role, title });
    });
    return privateJson(created, 201);
  } catch (error) {
    return lessonErrorResponse(error, "The lesson could not be created. Try again.");
  }
}
