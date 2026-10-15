import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { allLessonIds } from "../../../../lib/cad-learn/track";
import {
  HttpError,
  failResponse,
  isLead,
  markProgress,
  readMyProgress,
  readReferenceParts,
  readSubmissions,
  readTeamProgress,
  requestedOrgId,
  resolveMembership,
} from "../../../../lib/cad-learn/store";

/**
 * Progress through the CAD track, plus everything the page needs to render.
 *
 * The programming guide keeps its ticks in localStorage, which is honest for a
 * personal checklist and useless to a mentor. This track ends in a graded part,
 * so "who has not submitted" is a real question and progress lives server-side.
 *
 * A student gets their own rows. A lead additionally gets the team roster —
 * RLS in 0613 is what actually enforces that, and the `isLead` check here only
 * decides whether to ASK for the roster, so a student never sees a table
 * containing one row (themselves) and concludes the team has one member.
 *
 * The team is the one the page names (`orgId` in the query string or the POST
 * body), so someone on two teams reads and writes the same one. It is only
 * ever one of the caller's own memberships: naming any other team is a 403.
 */

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const requestedOrg = requestedOrgId(new URL(request.url).searchParams.get("orgId"));

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const lead = isLead(membership);
      return {
        orgId: membership.orgId,
        orgName: membership.orgName,
        viewerId: session.user.id,
        canManage: lead,
        progress: await readMyProgress(client, membership.orgId, session.user.id),
        references: await readReferenceParts(client, membership.orgId),
        // The viewer's own attempts only: a lead's view would otherwise list the team's under "Your attempts".
        submissions: await readSubmissions(client, membership.orgId, session.user.id),
        team: lead ? await readTeamProgress(client, membership.orgId) : null,
      };
    });

    return Response.json(view);
  } catch (error) {
    return failResponse(error, "Could not load your CAD track progress");
  }
}

type Body = { lessonId?: string; action?: string; orgId?: string | null };

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const body = (await request.json().catch(() => ({}))) as Body;
    const requestedOrg = requestedOrgId(body.orgId);

    const lessonId = String(body.lessonId ?? "");
    // Only ids that exist in the shipped curriculum. Without this, the table
    // slowly fills with typos and stale ids and the mentor's counts drift.
    if (!allLessonIds().includes(lessonId)) throw new HttpError(400, "Unknown lesson");

    const action = body.action === "complete" ? "complete" : body.action === "reopen" ? "reopen" : "view";

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      return markProgress(client, {
        orgId: membership.orgId,
        userId: session.user.id,
        lessonId,
        completed: action === "complete",
      });
    });

    return Response.json({ ok: true, progress: result });
  } catch (error) {
    return failResponse(error, "Could not record that");
  }
}
