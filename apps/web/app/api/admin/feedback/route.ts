import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  platformAdminDeniedResponse,
  writeAdminAction,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import { z } from "zod";
import {
  FEEDBACK_STATUSES,
  feedbackCounts,
  listAdminFeedback,
  parseFeedbackFilters,
  setFeedbackStatus,
} from "../../../../lib/feedback/admin-feedback";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";

/**
 * Platform-admin Feedback inbox. GET lists the notes sent from the Send feedback dialog (newest
 * first, optionally one kind and/or one status) with the counts the filters show; POST moves one
 * note along new -> triaged -> fixed / won't fix. Same gate as /api/admin/support: a signed-in
 * person who is not a platform admin gets a plain 404 and nothing else, and the request body is
 * not even read for them.
 */

async function runAdmin<T>(
  work: (ctx: { client: PoolClient; session: { user: { id: string } } }) => Promise<T>,
  requireMfa = false,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    if (requireMfa) {
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
    }
    return work({ client, session });
  });
}

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: Request) {
  try {
    const filters = parseFeedbackFilters(new URL(request.url).searchParams);
    const payload = await runAdmin(async ({ client }) => {
      const [list, counts] = await Promise.all([listAdminFeedback(client, filters), feedbackCounts(client)]);
      return { items: list.items, hasMore: list.hasMore, counts };
    });
    return privateJson(payload);
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(FEEDBACK_STATUSES) }).strict();

export async function POST(request: Request) {
  try {
    const change = await runAdmin(async ({ client, session }) => {
      const body = await parseSecureJson(request, statusSchema);
      const updated = await setFeedbackStatus(client, body);
      if (!updated) return null;
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "feedback.status_changed",
        ...(updated.orgId ? { targetOrgId: updated.orgId } : {}),
        targetUserId: updated.reporterId,
        payload: { reportId: updated.id, kind: updated.kind, status: updated.status },
      });
      return { id: updated.id, status: updated.status, counts: await feedbackCounts(client) };
    }, true);
    if (!change) return privateJson({ error: "That note no longer exists." }, { status: 404 });
    return privateJson(change);
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not update the note.");
    return platformAdminDeniedResponse(error);
  }
}
