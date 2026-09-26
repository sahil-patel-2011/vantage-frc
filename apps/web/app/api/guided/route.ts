import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { HttpError, failResponse, markProgress, resolveMembership } from "../../../lib/cad-learn/store";
import { runGuidedCheck, type CheckInput } from "../../../lib/guided/run-check";
import { guidedStep, guidedTrack } from "../../../lib/guided/tracks";
import { GUIDED_PREFIX, guidedLessonId } from "../../../lib/guided/types";

/** The signed-in student's finished steps on one guided track. */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const url = new URL(request.url);
    const track = guidedTrack(url.searchParams.get("track") ?? "");
    if (!track) throw new HttpError(404, "Unknown track");
    const done = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, url.searchParams.get("orgId"));
      const rows = await client.query<{ lessonId: string; completedAt: string }>(
        `SELECT lesson_id AS "lessonId", completed_at::text AS "completedAt"
           FROM cad_learn_progress
          WHERE org_id = $1::uuid AND user_id = $2::uuid AND completed_at IS NOT NULL
            AND lesson_id LIKE $3`,
        [membership.orgId, session.user.id, `${GUIDED_PREFIX}${track.id}:%`],
      );
      return rows.rows.map((row) => ({ stepId: row.lessonId.slice(`${GUIDED_PREFIX}${track.id}:`.length), completedAt: row.completedAt }));
    });
    return Response.json({ trackId: track.id, done }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return failResponse(error, "Could not load this track");
  }
}

type Body = { trackId?: string; stepId?: string; input?: CheckInput; action?: string };

/** Runs a step's check and, when it passes, records the step as done. `action: "reopen"` undoes it. */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const body = (await request.json().catch(() => ({}))) as Body;
    const step = guidedStep(String(body.trackId ?? ""), String(body.stepId ?? ""));
    if (!step) throw new HttpError(400, "Unknown step");
    const lessonId = guidedLessonId(String(body.trackId), step.id);

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      const who = { orgId: membership.orgId, userId: session.user.id };
      if (body.action === "reopen") {
        await markProgress(client, { ...who, lessonId, completed: false });
        return { passed: false, message: "Reopened. Check it again when you are ready." };
      }
      const outcome = await runGuidedCheck(client, who, step.check, body.input ?? {});
      if (outcome.passed) await markProgress(client, { ...who, lessonId, completed: true });
      return outcome;
    });
    return Response.json(result);
  } catch (error) {
    return failResponse(error, "Could not check that step");
  }
}
