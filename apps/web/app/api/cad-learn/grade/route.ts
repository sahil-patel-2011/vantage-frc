import {
  CAD_GRADE_TOLERANCE,
  CAD_LEARN_MATERIAL,
  gradeMassProperties,
  readOnshapeMassProperties,
  resolveOnshapeBind,
} from "@vantage/cad";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { acquireOnshape } from "../../../../lib/cad-learn/onshape-access";
import {
  HttpError,
  failResponse,
  readReferenceForLesson,
  recordSubmission,
  referenceAsMassProperties,
  requestedOrgId,
  resolveMembership,
} from "../../../../lib/cad-learn/store";
import { gradableLessons } from "../../../../lib/cad-learn/track";

/**
 * Grade a student's Onshape part against their team's reference part.
 *
 * TWO FACTORS, MEASURED, OR NOTHING
 *
 * Mass and moment of inertia, both read live from Onshape's /massproperties
 * endpoint over the student's own OAuth connection. Not centre of mass:
 * Onshape's reported centroid moves with where the part sits relative to the
 * Part Studio origin, so grading on it would fail correct work.
 *
 * Every path that cannot measure returns a `status` other than "graded", with
 * the reason in plain English, and writes NOTHING to cad_learn_submissions:
 *
 *   not_connected  no Onshape OAuth for this org, or this student has not
 *                  connected their account
 *   no_reference   nobody has bound the correct part for this lesson yet
 *   cannot_read    Onshape refused, errored, or the part has no mass
 *
 * This codebase has already shipped two invented metrics — a Readiness Score
 * that rose the less a team entered, and a battery score where an untested pack
 * scored 100 and went to the drive team first. A grade that appears when
 * nothing could be measured would be the third, and it would be aimed at a
 * 15-year-old being told whether their work is right.
 *
 * MATERIAL
 *
 * Both parts are compared on cast iron. Mass and MOI are both linear in
 * density, so a mismatch makes both numbers meaningless — the grader checks it
 * by comparing the two parts' own mass/volume densities and says so before it
 * says anything about geometry.
 */

type Body = { lessonId?: string; url?: string; orgId?: string | null };

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const userId = session.user.id;
    const body = (await request.json().catch(() => ({}))) as Body;
    const requestedOrg = requestedOrgId(body.orgId);

    const lessonId = String(body.lessonId ?? "");
    const lesson = gradableLessons().find((entry) => entry.id === lessonId);
    if (!lesson) throw new HttpError(400, "That lesson is not one the grader can score");
    const url = String(body.url ?? "").trim();
    if (!url) throw new HttpError(400, "Paste the URL of your Onshape Part Studio");

    // 1. A short transaction: whose team, which reference, which Onshape token.
    //    Onshape is slow, so nothing below holds a database connection while it answers.
    const prepared = await withRls({ userId }, async (client) => {
      const membership = await resolveMembership(client, userId, requestedOrg);

      const referenceRow = await readReferenceForLesson(client, membership.orgId, lessonId);
      if (!referenceRow) {
        return {
          ready: false as const,
          response: {
            status: "no_reference" as const,
            message:
              "Nobody on your team has set the reference part for this lesson yet, so there is nothing to compare against. Ask your CAD lead to set it. Nothing was graded.",
          },
        };
      }

      const access = await acquireOnshape(client, membership.orgId, userId);
      if (!access.ok) {
        return {
          ready: false as const,
          response: { status: "not_connected" as const, message: `${access.message} Nothing was graded.` },
        };
      }
      return { ready: true as const, orgId: membership.orgId, referenceRow, http: access.http };
    });
    if (!prepared.ready) return Response.json(prepared.response);
    const { orgId, referenceRow, http } = prepared;

    // 2. Onshape, outside any transaction.
    let bound;
    try {
      bound = await resolveOnshapeBind(url, http);
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error
          ? error.message
          : "That is not an Onshape document URL. Paste the link from the Part Studio tab.",
      );
    }

    const read = await readOnshapeMassProperties(http, {
      documentId: bound.documentId,
      workspaceId: bound.workspaceId,
      elementId: bound.elementId,
    });
    if (!read.ok) {
      return Response.json({ status: "cannot_read" as const, reason: read.reason, message: read.message });
    }

    const grade = gradeMassProperties({
      reference: referenceAsMassProperties(referenceRow),
      student: read.value,
    });

    const mass = grade.factors.find((factor) => factor.id === "mass")!;
    const inertia = grade.factors.find((factor) => factor.id === "moment_of_inertia") ?? null;

    // 3. A second short transaction records the attempt. RLS re-checks that the
    //    caller is on this team and is writing their own row.
    await withRls({ userId }, async (client) => {
      await recordSubmission(client, {
        orgId,
        userId,
        lessonId,
        documentId: bound.documentId,
        workspaceId: bound.workspaceId,
        elementId: bound.elementId,
        measured: read.value,
        massPercentDifference: mass.percentDifference,
        // NULL, not zero: "we did not measure MOI" and "MOI is perfect" must
        // never look the same in the mentor's view.
        inertiaPercentDifference: inertia ? inertia.percentDifference : null,
        overallBand: grade.overall,
        material: CAD_LEARN_MATERIAL,
      });
    });

    return Response.json({
      status: "graded" as const,
      lessonId,
      lessonTitle: lesson.title,
      material: CAD_LEARN_MATERIAL,
      tolerance: CAD_GRADE_TOLERANCE,
      referenceMeasuredAt: referenceRow.measuredAt,
      grade,
      openUrl: bound.url,
    });
  } catch (error) {
    return failResponse(error, "Could not grade that part");
  }
}
