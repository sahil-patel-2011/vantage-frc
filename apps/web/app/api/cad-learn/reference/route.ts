import { CAD_LEARN_MATERIAL, readOnshapeMassProperties, resolveOnshapeBind } from "@vantage/cad";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { acquireOnshape } from "../../../../lib/cad-learn/onshape-access";
import {
  HttpError,
  failResponse,
  isLead,
  readReferenceParts,
  resolveMembership,
  upsertReferencePart,
} from "../../../../lib/cad-learn/store";
import { gradableLessons } from "../../../../lib/cad-learn/track";

/**
 * The reference part for a lesson — the thing a student's part is graded
 * against. Leads only.
 *
 * The values are MEASURED, never typed. A lead pastes the Onshape URL of the
 * correct part and Vantage reads its mass properties over the lead's own OAuth
 * connection; if that read fails, nothing is stored and the lead is told why.
 * There is no field anywhere in this feature that lets someone assert "the
 * answer is 0.42 kg", which is the only way the reference stays trustworthy.
 *
 * Restricting writes to owners and admins is not cosmetic: a student who could
 * rebind the reference to their own document would be grading themselves
 * against themselves and scoring a perfect match every time. Migration 0613's
 * policy enforces it as well as this route does.
 */

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      return {
        orgId: membership.orgId,
        canManage: isLead(membership),
        material: CAD_LEARN_MATERIAL,
        references: await readReferenceParts(client, membership.orgId),
        gradableLessons: gradableLessons().map((lesson) => ({ id: lesson.id, title: lesson.title })),
      };
    });

    return Response.json(view);
  } catch (error) {
    return failResponse(error, "Could not load the reference parts");
  }
}

type Body = { lessonId?: string; url?: string };

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const body = (await request.json()) as Body;

    const lessonId = String(body.lessonId ?? "");
    if (!gradableLessons().some((lesson) => lesson.id === lessonId)) {
      throw new HttpError(400, "That lesson is not one the grader can score");
    }
    const url = String(body.url ?? "").trim();
    if (!url) throw new HttpError(400, "Paste the Onshape URL of the reference part");

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      if (!isLead(membership)) {
        throw new HttpError(403, "Only an owner or admin can set the reference part for a lesson");
      }

      const access = await acquireOnshape(client, membership.orgId, session.user.id);
      if (!access.ok) {
        // Setup-required, not an error page: the lead needs to connect Onshape.
        return { status: "not_connected" as const, message: access.message };
      }

      let bound;
      try {
        bound = await resolveOnshapeBind(url, access.http);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "That is not an Onshape document URL");
      }

      const read = await readOnshapeMassProperties(access.http, {
        documentId: bound.documentId,
        workspaceId: bound.workspaceId,
        elementId: bound.elementId,
      });
      if (!read.ok) {
        // Nothing is written. A reference row only ever exists because a real
        // measurement succeeded.
        return { status: "cannot_read" as const, reason: read.reason, message: read.message };
      }

      await upsertReferencePart(client, {
        orgId: membership.orgId,
        lessonId,
        userId: session.user.id,
        documentId: bound.documentId,
        workspaceId: bound.workspaceId,
        elementId: bound.elementId,
        material: CAD_LEARN_MATERIAL,
        measured: read.value,
      });

      return {
        status: "measured" as const,
        lessonId,
        material: CAD_LEARN_MATERIAL,
        massKg: read.value.massKg,
        principalInertiaKgM2: read.value.principalInertiaKgM2,
        densityKgM3: read.value.densityKgM3,
        // A reference with no principal moments can still grade mass, and the
        // lead should know that before students start submitting.
        gradesInertia: read.value.principalInertiaKgM2 !== null,
      };
    });

    return Response.json(result);
  } catch (error) {
    return failResponse(error, "Could not set the reference part");
  }
}
